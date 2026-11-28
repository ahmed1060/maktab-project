import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import {
    policyOfDraft, salaryAdvancePolicyErrors,
    type SalaryAdvancePolicy, type SalaryAdvancePolicyDraft, type SalaryAdvancePolicyErrors,
} from "@/lib/salary-advance-policy"

/**
 * A company's salary advance rules (LATER_CHANGES_PLAN.md §7.5, step 2):
 * what Company Settings' card shows, and saving it. Columns on the company,
 * with their defaults for every company, so there's always a policy to read.
 * Nothing else reads them yet; asking for one comes in step 3.
 */

/** Refused, with what's wrong under each field, as the card says it. */
export class SalaryAdvancePolicyInvalid extends Error {
    constructor(readonly errors: SalaryAdvancePolicyErrors) { super("SALARY_ADVANCE_POLICY_INVALID") }
}

/** Who a change is audited as, as a company settings change is. */
const author = (session: any): { superAdminId: string } | { userId: string } =>
    session.user.role === "SUPER_ADMIN" ? { superAdminId: session.user.id } : { userId: session.user.id }

const SELECT = {
    salaryAdvanceMaxMonths: true, salaryAdvanceMinServiceMonths: true, salaryAdvanceOneOpen: true,
    salaryAdvanceInstallmentPercent: true, debtsLimitPercent: true, salaryAdvanceOverLimit: true,
} as const

type Row = Prisma.CompanyGetPayload<{ select: typeof SELECT }>

const policyOf = (row: Row): SalaryAdvancePolicy => ({
    maxMonths: Number(row.salaryAdvanceMaxMonths),
    minServiceMonths: row.salaryAdvanceMinServiceMonths,
    oneOpen: row.salaryAdvanceOneOpen,
    installmentPercent: Number(row.salaryAdvanceInstallmentPercent),
    debtsPercent: Number(row.debtsLimitPercent),
    overLimit: row.salaryAdvanceOverLimit,
})

/** Each of the rules by the name the audit log labels it with (audit_field_*). */
const AUDITED: Record<keyof SalaryAdvancePolicy, string> = {
    maxMonths: "salaryAdvanceMaxMonths",
    minServiceMonths: "salaryAdvanceMinServiceMonths",
    oneOpen: "salaryAdvanceOneOpen",
    installmentPercent: "salaryAdvanceInstallmentPercent",
    debtsPercent: "debtsLimitPercent",
    overLimit: "salaryAdvanceOverLimit",
}

export class SalaryAdvancePolicyService {
    /** The company's rules, read through the caller's transaction where it has one; none for no such company. */
    static async view(companyId: string, db: Prisma.TransactionClient = prisma): Promise<SalaryAdvancePolicy | null> {
        const row = await db.company.findUnique({ where: { id: companyId }, select: SELECT })
        return row ? policyOf(row) : null
    }

    /**
     * Saves the card as a whole, as Payroll settings saves its fields, once
     * nothing on it is wrong. What changed is in the audit log, on the
     * company, from what to what; saved unchanged, nothing is logged.
     */
    static async save(companyId: string, draft: SalaryAdvancePolicyDraft, session: any): Promise<SalaryAdvancePolicy> {
        const errors = salaryAdvancePolicyErrors(draft)
        if (Object.keys(errors).length > 0) throw new SalaryAdvancePolicyInvalid(errors)
        const next = policyOfDraft(draft)

        const { before, after } = await prisma.$transaction(async tx => {
            // One save at a time for a company, so what's logged as before is
            // what this save changed.
            await tx.$executeRaw`SELECT 1 FROM "Company" WHERE id = ${companyId} FOR UPDATE`
            const before = await this.view(companyId, tx)
            if (!before) throw new Error("Company not found")
            const row = await tx.company.update({
                where: { id: companyId },
                data: {
                    salaryAdvanceMaxMonths: new Prisma.Decimal(next.maxMonths),
                    salaryAdvanceMinServiceMonths: next.minServiceMonths,
                    salaryAdvanceOneOpen: next.oneOpen,
                    salaryAdvanceInstallmentPercent: new Prisma.Decimal(next.installmentPercent),
                    debtsLimitPercent: new Prisma.Decimal(next.debtsPercent),
                    salaryAdvanceOverLimit: next.overLimit,
                },
                select: SELECT,
            })
            return { before, after: policyOf(row) }
        })

        const changes: Record<string, { old: unknown; new: unknown }> = {}
        for (const key of Object.keys(AUDITED) as (keyof SalaryAdvancePolicy)[]) {
            if (before[key] !== after[key]) changes[AUDITED[key]] = { old: before[key], new: after[key] }
        }
        if (Object.keys(changes).length > 0) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("UPDATE_SALARY_ADVANCE_POLICY", "COMPANY", companyId, { ...author(session), details: changes })
        }
        return after
    }
}
