import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { calendarDateStr } from "@/lib/time"
import { addDays, toDateString } from "@/lib/attendance/calendar"
import { previousMonth } from "@/lib/payroll-period"

/**
 * What the days a request may be asked for count from (LATER_CHANGES_PLAN.md
 * §7.4, §7.20): today, the company's, in its time zone; the first day not in
 * an approved or paid payroll's period (§7.10), none where no month is; and
 * `from`, the first day any request may be asked for, the owner's choice
 * (28 November): the first day of the payroll month today is in, by when
 * payroll closes, or of last month's until last month's payroll is
 * approved, its draft saved or not; never before the first day not
 * approved, nor before the company's first attendance policy once it's in
 * force (§7.19). Day off reads them with its policy's months ahead (4a),
 * permission hours with one month where the policy says any day (4b), a
 * mission with a year, and a missing punch up to today.
 */
export async function requestDaysBasis(companyId: string, db: Prisma.TransactionClient = prisma): Promise<{ today: string; firstOpen: string | null; from: string }> {
    const company = await db.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
    const today = calendarDateStr(new Date(), company?.timezone ?? undefined)
    // The latest month paid for, by its month: its period ends where the next one's open days begin.
    const approved = await db.payrollRun.findFirst({
        where: { companyId, status: { in: ["APPROVED", "PAID"] } },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        select: { year: true, month: true },
    })
    const { PayrollPeriodService } = await import("./payroll-period.service")
    const firstOpen = approved ? addDays((await PayrollPeriodService.periodOf(db, companyId, approved.year, approved.month)).to, 1) : null
    // The payroll month before the one today is in stays open until its payroll is approved, its draft saved
    // or not (on the 1st, before anyone opens it, a punch missed the day before can still be reported); once
    // it is, the first day not approved is this payroll month's first.
    const key = (await PayrollPeriodService.payrollMonthsOf(db, companyId, [today])).get(today)!
    const last = previousMonth(Number(key.slice(0, 4)), Number(key.slice(5, 7)))
    let from = (await PayrollPeriodService.periodOf(db, companyId, last.year, last.month)).from
    if (firstOpen && firstOpen > from) from = firstOpen
    // Nothing was asked of anyone before the company's first policy, once it's in force.
    const first = await db.attendancePolicy.findFirst({ where: { companyId }, orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true } })
    const firstPolicy = first ? toDateString(first.effectiveFrom) : null
    if (firstPolicy && firstPolicy <= today && firstPolicy > from) from = firstPolicy
    return { today, firstOpen, from }
}
