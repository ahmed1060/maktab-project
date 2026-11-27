import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { calendarDateStr } from "@/lib/time"
import { addDays } from "@/lib/attendance/calendar"

/**
 * What the days a request may be asked for count from (LATER_CHANGES_PLAN.md
 * §7.4): today, the company's, in its time zone; and the first day not in an
 * approved or paid payroll's period (§7.10), none where no month is. Day off
 * reads them with its policy's months ahead (4a), permission hours with one
 * month where the policy says any day (4b).
 */
export async function requestDaysBasis(companyId: string, db: Prisma.TransactionClient = prisma): Promise<{ today: string; firstOpen: string | null }> {
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
    return { today, firstOpen }
}
