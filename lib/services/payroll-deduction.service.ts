import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import {
    deductionErrors, figure, type DeductionErrors, type DeductionsDraft, type PayrollDeductionBasis, type PayrollDeductionRule,
} from "@/lib/payroll-deductions"

/**
 * A company's payroll deductions (LATER_CHANGES_PLAN.md §7.12, PR 440):
 * what its card shows, what payroll takes, and saving the card.
 *
 * Payroll reads them only for a month not approved yet. An approved
 * payslip keeps its lines, so nothing here reaches a month already
 * approved, whatever is changed or removed.
 */

export interface DeductionsView {
    incomeTax: number
    socialInsurance: number
    more: { id: string; name: string; basis: PayrollDeductionBasis; value: number }[]
}

/** Refused, with what's wrong under each field, as the card says it. */
export class DeductionsInvalid extends Error {
    constructor(readonly errors: DeductionErrors) { super("DEDUCTIONS_INVALID") }
}

/** Who a change is audited as, as a company settings change is. */
const author = (session: any): { superAdminId: string } | { userId: string } =>
    session.user.role === "SUPER_ADMIN" ? { superAdminId: session.user.id } : { userId: session.user.id }

/** A deduction in the audit log: its name and what it takes. */
const described = (d: { name: string; basis: PayrollDeductionBasis; value: number }) =>
    `${d.name}: ${d.basis === "PERCENT" ? `${d.value}%` : d.value.toFixed(2)}`

export class PayrollDeductionService {
    /** What payroll takes this month, read through the caller's transaction where it has one. */
    static async rules(companyId: string, db: Prisma.TransactionClient = prisma): Promise<PayrollDeductionRule[]> {
        const rows = await db.payrollDeduction.findMany({
            where: { companyId },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        })
        return rows.map(r => ({ id: r.id, kind: r.kind, name: r.name, basis: r.basis, value: Number(r.value), sortOrder: r.sortOrder }))
    }

    /** What the card shows: 0 for one never set. */
    static async view(companyId: string, db: Prisma.TransactionClient = prisma): Promise<DeductionsView> {
        const rules = await this.rules(companyId, db)
        return {
            incomeTax: rules.find(r => r.kind === "INCOME_TAX")?.value ?? 0,
            socialInsurance: rules.find(r => r.kind === "SOCIAL_INSURANCE")?.value ?? 0,
            more: rules.filter(r => r.kind === "OTHER").map(r => ({ id: r.id, name: r.name ?? "", basis: r.basis, value: r.value })),
        }
    }

    /**
     * Saves the card as a whole, as Payroll settings saves its fields: what's
     * on it stays, what's gone from it goes. One of the company's own keeps
     * its id while it's on the card, so the people it's set for one by one
     * later (§7.12, 9b) keep theirs through a rename.
     */
    static async save(companyId: string, draft: DeductionsDraft, session: any): Promise<DeductionsView> {
        const errors = deductionErrors(draft)
        if (Object.keys(errors).length > 0) throw new DeductionsInvalid(errors)

        const { before, after } = await prisma.$transaction(async tx => {
            // One save at a time for a company, so two at once can't both
            // add the same name or leave a deduction the other removed.
            await tx.$executeRaw`SELECT 1 FROM "Company" WHERE id = ${companyId} FOR UPDATE`
            const before = await this.view(companyId, tx)

            for (const [kind, text] of [["INCOME_TAX", draft.incomeTax], ["SOCIAL_INSURANCE", draft.socialInsurance]] as const) {
                const value = new Prisma.Decimal(figure(text))
                const existing = await tx.payrollDeduction.findFirst({ where: { companyId, kind } })
                if (existing) await tx.payrollDeduction.update({ where: { id: existing.id }, data: { value } })
                else if (!value.isZero()) await tx.payrollDeduction.create({ data: { companyId, kind, basis: "PERCENT", value } })
            }

            const kept = new Set(before.more.map(m => m.id))
            const onCard = draft.more.filter(d => d.id && kept.has(d.id)).map(d => d.id!)
            await tx.payrollDeduction.deleteMany({ where: { companyId, kind: "OTHER", id: { notIn: onCard } } })
            // Out of the way first, so two swapping names don't meet on the way.
            for (const id of onCard) await tx.payrollDeduction.update({ where: { id }, data: { name: `#${id}` } })
            for (const [index, d] of draft.more.entries()) {
                const data = { name: d.name.trim(), basis: d.basis, value: new Prisma.Decimal(figure(d.value)), sortOrder: index }
                if (d.id && kept.has(d.id)) await tx.payrollDeduction.update({ where: { id: d.id }, data })
                else await tx.payrollDeduction.create({ data: { companyId, kind: "OTHER", ...data } })
            }

            return { before, after: await this.view(companyId, tx) }
        })

        const changes: Record<string, { old: unknown; new: unknown }> = {}
        if (before.incomeTax !== after.incomeTax) changes.incomeTax = { old: before.incomeTax, new: after.incomeTax }
        if (before.socialInsurance !== after.socialInsurance) changes.socialInsurance = { old: before.socialInsurance, new: after.socialInsurance }
        const was = before.more.map(described), is = after.more.map(described)
        if (was.join("\n") !== is.join("\n")) changes.payrollDeductionsMore = { old: was, new: is }
        if (Object.keys(changes).length > 0) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("UPDATE_PAYROLL_DEDUCTIONS", "COMPANY", companyId, { ...author(session), details: changes })
        }
        return after
    }
}
