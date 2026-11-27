import { prisma } from "@/lib/prisma"
import { calendarDateStr } from "@/lib/time"
import { LOCK_WAIT, lockMonths, lockPersonDates, lockedMonths } from "./attendance-lock"
import { inContractStartRange, planContractStart, startOfDate } from "@/lib/contract-start"

/**
 * The contract start date (LATER_CHANGES_PLAN.md §7.2, step 1, PR 425):
 * read for a person's profile, and changed, with what moves with it, as
 * lib/contract-start.ts works it out.
 */

export class ContractStartService {
    /**
     * When someone's contract started, in their company's calendar, and when
     * their hiring was recorded, which is when their account was made: from
     * their first hiring. Null for someone with none, as the Super Admin.
     */
    static async of(userId: string): Promise<{ date: string; recordedAt: Date } | null> {
        const hire = await prisma.employmentEvent.findFirst({
            where: { userId, type: "HIRED" },
            orderBy: { effectiveFrom: "asc" },
            select: { effectiveFrom: true, createdAt: true, user: { select: { company: { select: { timezone: true } } } } },
        })
        if (!hire?.user.company) return null
        return { date: calendarDateStr(hire.effectiveFrom, hire.user.company.timezone), recordedAt: hire.createdAt }
    }

    /**
     * Moves someone's contract start to `date`, in their company's calendar.
     * Refused, with its code as the Error's message: a date that isn't one,
     * or is more than a year away (CONTRACT_START_OUT_OF_RANGE); the date it
     * is already, or later than something else recorded about their job
     * (lib/contract-start.ts); in a month, between the old date and the new,
     * whose payroll is approved (PAYROLL_MONTH_LOCKED).
     *
     * Who may ask is the route's to check. Their days are worked out again
     * from the earlier of the two dates, once it's written.
     */
    static async change(userId: string, date: unknown, by: { userId: string | null; superAdminId: string | null }): Promise<{ from: string; to: string }> {
        const person = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, company: { select: { timezone: true } } } })
        if (!person?.companyId || !person.company) throw new Error("NO_CONTRACT_START")
        const { companyId } = person
        const zone = person.company.timezone
        const today = calendarDateStr(new Date(), zone)
        if (!inContractStartRange(date, today)) throw new Error("CONTRACT_START_OUT_OF_RANGE")
        const to = startOfDate(date, zone)

        const out = await prisma.$transaction(async tx => {
            // One change to a person's dates at a time: their leave and missions
            // take the same lock.
            await lockPersonDates(tx, userId)
            const [events, salaries] = await Promise.all([
                tx.employmentEvent.findMany({ where: { userId }, select: { id: true, type: true, effectiveFrom: true } }),
                tx.salaryChange.findMany({ where: { userId }, select: { id: true, effectiveFrom: true, createdAt: true } }),
            ])
            const plan = planContractStart({ to, events, salaries })
            if (!plan.ok) throw new Error(plan.refusal)
            const from = calendarDateStr(plan.from, zone)
            const [first, last] = from < date ? [from, date] : [date, from]
            const { monthsBetween } = await import("./attendance-engine.service")
            const months = monthsBetween(first, last)
            await lockMonths(tx, companyId, months)
            if ((await lockedMonths(tx, companyId, months)).size > 0) throw new Error("PAYROLL_MONTH_LOCKED")

            await tx.employmentEvent.update({ where: { id: plan.hireId }, data: { effectiveFrom: to } })
            if (plan.moveSalaryIds.length > 0) await tx.salaryChange.updateMany({ where: { id: { in: plan.moveSalaryIds } }, data: { effectiveFrom: to } })

            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("CONTRACT_START_CHANGED", "USER", userId, {
                userId: by.userId, superAdminId: by.superAdminId, tx,
                details: { from, to: date, salaryMoved: plan.moveSalaryIds.length > 0 },
            })
            return { from, to: date, earlier: plan.from.getTime() < to.getTime() ? plan.from : to }
        }, LOCK_WAIT)

        // Never undoing the change: the nightly run catches up where this fails.
        try {
            const { recomputeForPersonFrom } = await import("./attendance-recompute")
            await recomputeForPersonFrom(userId, out.earlier)
        } catch (error) {
            console.error("[contract start] recompute after a change failed", userId, error)
        }
        return { from: out.from, to: out.to }
    }
}
