import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { calendarDateStr } from "@/lib/time"
import { ownerSince } from "@/lib/owners"
import { rateAt } from "@/lib/salary-history"
import { toMinor } from "@/lib/payroll"
import { percentOf, rulesFor } from "@/lib/payroll-deductions"
import {
    advanceCheck, consentWords, largestInstallment, maxAmountOf, monthAfter, netPayOf, otherDebtsOf, payrollMonthKey, payrollMonthOfKey, serviceFrom,
    type AdvanceCheck, type AdvanceClosed, type AdvanceDraft, type AdvanceOffer, type PayrollMonth,
} from "@/lib/salary-advance"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import { companyHasModule } from "./company-package"
import { SalaryAdvancePolicyService } from "./salary-advance-policy.service"
import { PayrollDeductionService } from "./payroll-deduction.service"
import { PersonDeductionService } from "./person-deduction.service"
import { PayrollPeriodService } from "./payroll-period.service"
import { AuditLogService } from "./audit-log.service"

/**
 * Asking for a salary advance (LATER_CHANGES_PLAN.md §7.5, step 3a, PR 449;
 * DESIGN.md §5.5, Asking for a salary advance): what one person may ask for,
 * worked out from the policy, their monthly salary, its net pay and their
 * other debts; asking, checked again by the same rules (lib/salary-advance.ts)
 * in one transaction holding the person's row; and withdrawing one while it
 * waits. Approving is step 3b's.
 */

type Db = Prisma.TransactionClient | typeof prisma

/** Waiting, or approved and being paid back: what "only one at a time" counts. */
const OPEN = ["PENDING", "APPROVED"] as const

/** Refused, with what the dialog says of it: why none may be asked for, or what's wrong under each field. */
export class SalaryAdvanceRefused extends Error {
    constructor(
        readonly code: "SALARY_ADVANCE_NOT_OFFERED" | "SALARY_ADVANCE_CLOSED" | "SALARY_ADVANCE_INVALID",
        readonly closed: AdvanceClosed | null = null,
        readonly errors: AdvanceCheck["errors"] = {},
    ) { super(code) }
}

export class SalaryAdvanceService {
    /**
     * What asking offers this person, or none where they may not ask at all:
     * the Super Admin, someone of no company or with no contract, an owner,
     * who has no payslips to pay it back from, or someone whose company
     * hasn't Payroll. Read
     * through the caller's transaction where it has one.
     */
    static async offer(userId: string, db: Db = prisma): Promise<AdvanceOffer | null> {
        const person = await db.user.findUnique({
            where: { id: userId },
            select: {
                companyId: true,
                company: { select: { timezone: true, debtRecoveryPercent: true } },
                ownerPeriods: { select: { id: true, startsAt: true, endsAt: true } },
            },
        })
        if (!person?.companyId || !person.company) return null
        if (ownerSince(person.ownerPeriods)) return null
        const { companyId } = person
        if (!(await companyHasModule(companyId, "PAYROLL", db))) return null
        const policy = await SalaryAdvancePolicyService.view(companyId, db)
        if (!policy) return null
        // Whoever has a contract: one recorded when their account was made, which every employee has.
        const hire = await db.employmentEvent.findFirst({ where: { userId, type: "HIRED" }, orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true } })
        if (!hire) return null
        const started = calendarDateStr(hire.effectiveFrom, person.company.timezone)
        const now = new Date()
        const today = calendarDateStr(now, person.company.timezone)

        // The first installment: this payroll month's, by when payroll closes, or next month's;
        // next month's alone where this month's payroll is approved or paid.
        const key = (await PayrollPeriodService.payrollMonthsOf(db, companyId, [today])).get(today)!
        const thisMonth = payrollMonthOfKey(key)!
        const approvedRun = await db.payrollRun.findFirst({
            where: { companyId, year: thisMonth.year, month: thisMonth.month, status: { in: ["APPROVED", "PAID"] } },
            select: { id: true },
        })
        const approved: PayrollMonth | null = approvedRun ? thisMonth : null
        const firsts = approved ? [monthAfter(thisMonth)] : [thisMonth, monthAfter(thisMonth)]

        // The monthly salary in force now, and its net pay after the payroll deductions, their own where they have them.
        const changes = await db.salaryChange.findMany({ where: { userId }, select: { monthlyAmount: true, effectiveFrom: true, reason: true, createdAt: true } })
        const rate = rateAt(changes.map(c => ({ ...c, monthlyAmount: c.monthlyAmount.toString() })), now)
        const salaryMinor = rate ? Math.max(0, toMinor(rate.monthlyAmount)) : 0
        const rules = rulesFor(await PayrollDeductionService.rules(companyId, db), (await PersonDeductionService.settings(companyId, db)).get(userId))
        const netMinor = netPayOf(salaryMinor, rules)

        // A month of their other debts: what's still owed, as a payslip takes it back, and their open advances' installments.
        const debts = await db.debt.findMany({ where: { userId, companyId, status: "OUTSTANDING" }, select: { amount: true, recoveredAmount: true } })
        const owedMinor = debts.reduce((sum, d) => sum + toMinor(d.amount.toString()) - toMinor(d.recoveredAmount.toString()), 0)
        const open = await db.salaryAdvance.findMany({
            where: { userId, status: { in: [...OPEN] } },
            orderBy: { createdAt: "desc" },
            select: { amount: true, months: true, status: true },
        })
        const installmentsMinor = open.reduce((sum, a) => sum + largestInstallment(toMinor(a.amount.toString()), a.months), 0)
        const otherDebtsMinor = otherDebtsOf({ owedMinor, netMinor, recoveryPercent: person.company.debtRecoveryPercent, installmentsMinor })

        // The months worked first count from the contract's start: their first hiring.
        const servedFrom = serviceFrom(started, policy.minServiceMonths)

        const closed: AdvanceClosed | null =
            today < servedFrom ? { reason: "SERVICE", months: policy.minServiceMonths, from: servedFrom }
                : policy.oneOpen && open.length > 0 ? { reason: "OPEN", status: open[0].status as "PENDING" | "APPROVED" }
                    : salaryMinor <= 0 ? { reason: "NO_SALARY" }
                        : netMinor <= 0 ? { reason: "NO_NET" }
                            : policy.overLimit === "BLOCK" && otherDebtsMinor >= percentOf(netMinor, policy.debtsPercent) ? { reason: "DEBTS", percent: policy.debtsPercent }
                                : null

        return {
            closed,
            salaryMinor,
            netMinor,
            otherDebtsMinor,
            maxAmountMinor: maxAmountOf(salaryMinor, policy.maxMonths),
            maxMonths: policy.maxMonths,
            installmentPercent: policy.installmentPercent,
            debtsPercent: policy.debtsPercent,
            overLimit: policy.overLimit,
            firsts,
            approved,
        }
    }

    /**
     * Asks for one, as the dialog sent it, in the language its consent was
     * shown in. Checked again by the dialog's own rules in one transaction
     * holding the person's row, so two sent at once by the same person
     * aren't both kept where only one may be open, and the second is
     * measured with the first among their other debts. What the limits were
     * measured against, which limit it's over, and the consent's words are
     * kept with it. Refused with SalaryAdvanceRefused.
     */
    static async ask(userId: string, draft: AdvanceDraft, locale: string): Promise<{ id: string }> {
        const language = locale === "ar" ? "ar" : "en"
        return prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`
            const offer = await this.offer(userId, tx)
            if (!offer) throw new SalaryAdvanceRefused("SALARY_ADVANCE_NOT_OFFERED")
            if (offer.closed) throw new SalaryAdvanceRefused("SALARY_ADVANCE_CLOSED", offer.closed)
            const check = advanceCheck(draft, offer)
            if (Object.keys(check.errors).length > 0) throw new SalaryAdvanceRefused("SALARY_ADVANCE_INVALID", null, check.errors)
            const first = payrollMonthOfKey(draft.first)!
            const person = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { companyId: true } })
            const consentText = consentWords(language === "ar" ? ar : en, check.amountMinor, language)
            const row = await tx.salaryAdvance.create({
                data: {
                    companyId: person.companyId!, userId,
                    amount: new Prisma.Decimal(check.amountMinor).div(100),
                    months: check.months,
                    firstYear: first.year, firstMonth: first.month,
                    salary: new Prisma.Decimal(offer.salaryMinor).div(100),
                    netPay: new Prisma.Decimal(offer.netMinor).div(100),
                    otherDebts: new Prisma.Decimal(offer.otherDebtsMinor).div(100),
                    overInstallment: check.over.installment,
                    overDebts: check.over.debts,
                    consentText, consentLocale: language, consentedAt: new Date(),
                },
                select: { id: true },
            })
            await AuditLogService.log("REQUEST_SALARY_ADVANCE", "SALARY_ADVANCE", row.id, {
                tx, userId,
                details: {
                    companyId: person.companyId, amount: (check.amountMinor / 100).toFixed(2), months: check.months, firstInstallment: payrollMonthKey(first),
                    overInstallment: check.over.installment, overDebts: check.over.debts,
                },
            })
            return row
        })
    }

    /** Withdraws one's own while it waits. */
    static async withdraw(id: string, userId: string): Promise<void> {
        await prisma.$transaction(async tx => {
            const r = await tx.salaryAdvance.findUnique({ where: { id }, select: { userId: true, companyId: true, amount: true, months: true } })
            if (!r || r.userId !== userId) throw new Error("REQUEST_NOT_FOUND")
            // Only while it waits, whatever else changed it meanwhile.
            const { count } = await tx.salaryAdvance.updateMany({ where: { id, status: "PENDING" }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } })
            if (count === 0) throw new Error("REQUEST_ALREADY_DECIDED")
            await AuditLogService.log("WITHDRAW_SALARY_ADVANCE", "SALARY_ADVANCE", id, {
                tx, userId,
                details: { companyId: r.companyId, amount: r.amount.toFixed(2), months: r.months },
            })
        })
    }
}
