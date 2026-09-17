import { prisma } from "@/lib/prisma"
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
        // The job that *creates* each month's salary record. It read UTC
        // while every path that later finds that record read the server's
        // local clock — disagree on the last day of a month and they name
        // different rows, which is an adjustment written against a month with
        // no record, or a second record for a month that already had one.
        const { month, year } = calendarMonth(now)

        const employees = await prisma.user.findMany({
            where: {
                status: { not: 'DELETED' },
                role: { in: ['EMPLOYEE', 'TEAM_LEADER', 'ADMIN'] }
            },
            select: { id: true, salary: true }
        })

        let createdCount = 0

        for (const employee of employees) {
            try {
                const { SalaryService } = await import("./salary.service")
                await SalaryService.ensureRecordExists(employee.id, month, year, employee.salary || 0)

                // If it was created (we can't easily tell from upsert without returning more info, 
                // but we'll assume success and log if needed. Actually upsert doesn't tell us if it created or updated easily)
                // We'll just count it as processed.
                createdCount++
            } catch (err) {
                console.error(`Failed to init salary for user ${employee.id}:`, err)
            }
        }

        return { success: true, month, year, created: createdCount }
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
