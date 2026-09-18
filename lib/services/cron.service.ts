import { prisma } from "@/lib/prisma"
import { resolveTimeZone } from "@/lib/timezone"
import { calendarMonth, calendarYear } from "@/lib/time"
import { planReset, RECONSTRUCTED_NOTE } from "@/lib/leave-reset"

export class CronService {
    /**
     * The annual leave reset: snapshot the closing balance, then hand back the
     * allowance.
     *
     * It writes a snapshot for every year it owes one, not just the most recent.
     * See lib/leave-reset.ts for why — the short version is that this job gets
     * one attempt a year, has no retry, and the snapshot table is unique on
     * [userId, year], so a year skipped here is a year that can never be
     * recorded at all.
     */
    static async resetDayOffCredits() {
        const now = new Date()
        const currentYear = calendarYear(now)

        const usersToReset = await prisma.user.findMany({
            where: {
                lastDayOffResetYear: { lt: currentYear }
            }
        })

        let count = 0
        let snapshots = 0
        const refused: { userId: string; lastResetYear: number }[] = []

        for (const user of usersToReset) {
            const plan = planReset(user.lastDayOffResetYear, currentYear)

            if (plan.kind === "UP_TO_DATE") continue
            if (plan.kind === "REFUSED") {
                // Surfaced rather than acted on. A span this long is a corrupt
                // lastDayOffResetYear, and the fix is for somebody to look at
                // that account, not for this job to write a quarter-century of
                // invented snapshots into a table nothing can delete from.
                console.error(`Refusing to reset user ${user.id}: lastDayOffResetYear is ${user.lastDayOffResetYear}`)
                refused.push({ userId: user.id, lastResetYear: user.lastDayOffResetYear })
                continue
            }

            try {
                await prisma.$transaction(async (tx) => {
                    // skipDuplicates, because a row that already exists must not
                    // abort the whole user. The old code let a unique-constraint
                    // collision fail the transaction, which left that account
                    // un-reset — and it would fail again identically every year
                    // after, forever.
                    const written = await tx.dayOffCreditSnapshot.createMany({
                        data: plan.years.map(({ year, reconstructed }) => ({
                            userId: user.id,
                            year,
                            baseCredit: user.baseDayOffCredit,
                            remainingCredit: user.dayOffCredit,
                            note: reconstructed ? RECONSTRUCTED_NOTE : null,
                        })),
                        skipDuplicates: true,
                    })
                    snapshots += written.count

                    await tx.user.update({
                        where: { id: user.id },
                        data: {
                            dayOffCredit: user.baseDayOffCredit,
                            lastDayOffResetYear: currentYear
                        }
                    })

                    // Audit Log (Centralized)
                    const { AuditLogService } = await import("./audit-log.service")
                    await AuditLogService.log('SYSTEM_DAY_OFF_RESET', 'USER', user.id, {
                        tx,
                        details: {
                            oldYear: user.lastDayOffResetYear,
                            newYear: currentYear,
                            yearsSnapshotted: plan.years.map(y => y.year),
                            reconstructedYears: plan.years.filter(y => y.reconstructed).map(y => y.year),
                            creditWas: user.dayOffCredit,
                            creditNow: user.baseDayOffCredit
                        }
                    })
                })
                count++
            } catch (err) {
                console.error(`Failed to reset user ${user.id}:`, err)
            }
        }

        return { success: true, count, snapshots, refused, year: currentYear }
    }

    static async initializeSalaries() {
        const now = new Date()

        // The job that *creates* each month's salary record, and the one place
        // "which month is it" used to be answered once for everybody.
        //
        // That was wrong twice over. It read a single zone — the platform
        // default — so a company in another calendar got whichever month Cairo
        // happened to be in. And it fired monthly, at 02:00 UTC on the 1st,
        // which is still the previous month anywhere more than two hours behind
        // UTC: the job would create next month's record while that customer was
        // living in this one, and then not run again until the month after.
        //
        // So the month is asked per company now, in that company's own
        // calendar, and the schedule is daily. Daily is not a fallback for
        // getting it wrong — it is what makes any zone work at all: a monthly
        // cron pinned to the 1st in UTC has exactly one chance to catch a
        // calendar it does not share, and misses. Every run is an upsert, so
        // the other 29 cost a query and change nothing.
        const settings = await prisma.systemSettings.findUnique({
            where: { id: "default" },
            select: { defaultTimezone: true },
        })
        const platformZone = settings?.defaultTimezone ?? null

        const companies = await prisma.company.findMany({ select: { id: true, timezone: true } })
        const zoneOf = new Map(companies.map(c => [c.id, resolveTimeZone(c.timezone, platformZone)]))
        // Anybody with no company of their own still needs a calendar; the
        // platform default is what it has always been for them.
        const fallbackZone = resolveTimeZone(null, platformZone)

        const employees = await prisma.user.findMany({
            where: {
                status: { not: 'DELETED' },
                role: { in: ['EMPLOYEE', 'TEAM_LEADER', 'ADMIN'] }
            },
            select: { id: true, salary: true, companyId: true }
        })

        // Grouped so each distinct calendar is resolved once rather than once
        // per employee — the month is a property of the zone, not of a person.
        const byZone = new Map<string, typeof employees>()
        for (const employee of employees) {
            const zone = (employee.companyId && zoneOf.get(employee.companyId)) || fallbackZone
            const group = byZone.get(zone) ?? []
            group.push(employee)
            byZone.set(zone, group)
        }

        let createdCount = 0
        const periods: { timeZone: string; year: number; month: number; employees: number }[] = []

        for (const [timeZone, group] of byZone) {
            const { month, year } = calendarMonth(now, timeZone)
            periods.push({ timeZone, year, month, employees: group.length })

            for (const employee of group) {
                try {
                    const { SalaryService } = await import("./salary.service")
                    await SalaryService.ensureRecordExists(employee.id, month, year, employee.salary || 0)
                    createdCount++
                } catch (err) {
                    // One person's record must not stop the rest of the company
                    // getting theirs — this job is the reason every later write
                    // has a row to find.
                    console.error(`Failed to init salary for user ${employee.id}:`, err)
                }
            }
        }

        return { success: true, created: createdCount, periods }
    }

    // CronService.dailyCheck() was removed here.
    //
    // Nothing ever called it. Over time every job inside it grew its own route
    // and its own schedule in vercel.json — reset-day-off, salary-init,
    // check-expiry, prune — and two never did: the subscription lifecycle, and
    // recurring obligations. Both had therefore never run in production. They
    // are now on /api/companies/check-subscriptions and /api/cron/obligations
    // respectively.
    //
    // Deleted rather than wired up, because reviving it would have re-run five
    // jobs that already have correct schedules, and because it also called
    // MaintenanceService.cleanupOrphanedAssets, which must not run on a
    // schedule — see the refusal inside that method.
}
