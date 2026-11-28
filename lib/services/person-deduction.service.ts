import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import {
    figure, orderedDeductions, personDeductionErrors,
    type PayrollDeductionKind, type PayrollDeductionRule,
    type PersonDeductionDraft, type PersonDeductionErrors, type PersonDeductionRow, type PersonDeductionSetting, type PersonDeductionsView,
} from "@/lib/payroll-deductions"

export type { PersonDeductionRow, PersonDeductionsView }
import { PayrollDeductionService } from "./payroll-deduction.service"

/**
 * A person's payroll deductions (LATER_CHANGES_PLAN.md §7.12, step 9b, PR
 * 442): each of the company's as the company takes it, their own figure in
 * its place, or not applied to them. What their card shows, what payroll
 * takes, and saving the card.
 *
 * Payroll reads them only for a month not approved yet, as it does the
 * company's. An approved month keeps each person's as it was approved with.
 */

/** Refused, with what's wrong under each deduction, as the card says it. */
export class PersonDeductionsInvalid extends Error {
    constructor(readonly errors: PersonDeductionErrors) { super("DEDUCTIONS_INVALID") }
}

/** Refused: the company's deductions changed since the card was opened. `current` is them now. */
export class DeductionsChanged extends Error {
    constructor(readonly current: PersonDeductionsView) { super("DEDUCTIONS_CHANGED") }
}

const BUILT_IN = ["INCOME_TAX", "SOCIAL_INSURANCE"] as const

/** Who a change is audited as, as a company settings change is. */
const author = (session: any): { superAdminId: string } | { userId: string } =>
    session.user.role === "SUPER_ADMIN" ? { superAdminId: session.user.id } : { userId: session.user.id }

/** The ref a card knows a deduction by: a built-in by its kind, which never changes, the company's own by its id. */
const refOf = (rule: { id: string; kind: PayrollDeductionKind }) => rule.kind === "OTHER" ? rule.id : rule.kind

/** What's taken from them, in the audit log, in English as its other details are. */
const described = (row: PersonDeductionRow) => {
    const name = row.kind === "INCOME_TAX" ? "Income tax" : row.kind === "SOCIAL_INSURANCE" ? "Social insurance" : row.name ?? ""
    const what = row.mode === "COMPANY" ? "as the company"
        : row.mode === "NONE" ? "not applied"
        : row.basis === "PERCENT" ? `${row.value}%` : (row.value ?? 0).toFixed(2)
    return `${name}: ${what}`
}

export class PersonDeductionService {
    /** Everyone's in a company, by person, read through the caller's transaction where it has one. */
    static async settings(companyId: string, db: Prisma.TransactionClient = prisma): Promise<Map<string, PersonDeductionSetting[]>> {
        const rows = await db.personDeduction.findMany({
            where: { deduction: { companyId } },
            orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
        })
        const people = new Map<string, PersonDeductionSetting[]>()
        for (const r of rows) {
            const list = people.get(r.userId) ?? []
            list.push({ deductionId: r.deductionId, mode: r.mode, value: r.mode === "OWN" ? Number(r.value) : null })
            people.set(r.userId, list)
        }
        return people
    }

    /**
     * What their card shows: income tax and social insurance, which every
     * company has at 0 until it saves one, then the company's own in the
     * card's order, each with what's set for them.
     */
    static async view(userId: string, db: Prisma.TransactionClient = prisma): Promise<PersonDeductionsView> {
        const person = await db.user.findUnique({ where: { id: userId }, select: { companyId: true } })
        if (!person?.companyId) return { deductions: [] }
        const rules = await PayrollDeductionService.rules(person.companyId, db)
        const mine = await db.personDeduction.findMany({ where: { userId, deductionId: { in: rules.map(r => r.id) } } })
        const set = new Map(mine.map(m => [m.deductionId, m]))
        const row = (rule: PayrollDeductionRule): PersonDeductionRow => {
            const s = set.get(rule.id)
            return {
                ref: refOf(rule), kind: rule.kind, name: rule.name, basis: rule.basis, company: rule.value,
                mode: s?.mode ?? "COMPANY", value: s?.mode === "OWN" ? Number(s.value) : null,
            }
        }
        const builtIns = BUILT_IN.map(kind => {
            const rule = rules.find(r => r.kind === kind)
            return rule ? row(rule) : { ref: kind, kind, name: null, basis: "PERCENT" as const, company: 0, mode: "COMPANY" as const, value: null }
        })
        return { deductions: [...builtIns, ...orderedDeductions(rules.filter(r => r.kind === "OTHER")).map(row)] }
    }

    /**
     * Saves their card as a whole. Refused where a figure isn't one, and
     * where the company's deductions aren't the ones the card was shown: one
     * added, removed or taken another way since, as their figure would be
     * read in a kind it wasn't typed in. One save at a time for a company,
     * with its own card and an approval, by the company row's lock.
     */
    static async save(userId: string, drafts: PersonDeductionDraft[], session: any): Promise<PersonDeductionsView> {
        const errors = personDeductionErrors(drafts)
        if (Object.keys(errors).length > 0) throw new PersonDeductionsInvalid(errors)

        const person = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
        if (!person?.companyId) throw new Error("USER_NOT_FOUND")
        const companyId = person.companyId

        const { before, after } = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT 1 FROM "Company" WHERE id = ${companyId} FOR UPDATE`
            const before = await this.view(userId, tx)
            const shown = drafts.map(d => `${d.ref}:${d.basis}`).sort().join("\n")
            const now = before.deductions.map(d => `${d.ref}:${d.basis}`).sort().join("\n")
            if (shown !== now) throw new DeductionsChanged(before)

            for (const d of drafts) {
                let deductionId = d.ref
                if ((BUILT_IN as readonly string[]).includes(d.ref)) {
                    const kind = d.ref as typeof BUILT_IN[number]
                    const existing = await tx.payrollDeduction.findFirst({ where: { companyId, kind }, select: { id: true } })
                    if (existing) deductionId = existing.id
                    else if (d.mode === "COMPANY") continue
                    // The company's at 0, as its card shows it, so their own has one to stand for.
                    else deductionId = (await tx.payrollDeduction.create({ data: { companyId, kind, basis: "PERCENT", value: new Prisma.Decimal(0) } })).id
                }
                if (d.mode === "COMPANY") {
                    await tx.personDeduction.deleteMany({ where: { userId, deductionId } })
                    continue
                }
                const value = d.mode === "OWN" ? new Prisma.Decimal(figure(d.value)) : null
                await tx.personDeduction.upsert({
                    where: { userId_deductionId: { userId, deductionId } },
                    create: { userId, deductionId, mode: d.mode, value },
                    update: { mode: d.mode, value },
                })
            }
            return { before, after: await this.view(userId, tx) }
        })

        const was = before.deductions.map(described), is = after.deductions.map(described)
        if (was.join("\n") !== is.join("\n")) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("UPDATE_PERSON_DEDUCTIONS", "USER", userId, { ...author(session), details: { personDeductions: { old: was, new: is } } })
        }
        return after
    }
}
