import { prisma } from "@/lib/prisma"

export class CronService {
    static async resetDayOffCredits() {
        const now = new Date()
        const currentYear = now.getFullYear()

        const usersToReset = await prisma.user.findMany({
            where: {
                lastDayOffResetYear: { lt: currentYear }
            }
        })

        let count = 0
        for (const user of usersToReset) {
            try {
                await prisma.$transaction(async (tx) => {
                    await tx.dayOffCreditSnapshot.create({
                        data: {
                            userId: user.id,
                            year: user.lastDayOffResetYear,
                            baseCredit: user.baseDayOffCredit,
                            remainingCredit: user.dayOffCredit
                        }
                    })

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
                        details: { oldYear: user.lastDayOffResetYear, newYear: currentYear, creditWas: user.dayOffCredit, creditNow: user.baseDayOffCredit }
                    })
                })
                count++
            } catch (err) {
                console.error(`Failed to reset user ${user.id}:`, err)
            }
        }

        return { success: true, count, year: currentYear }
    }

    static async initializeSalaries() {
        const now = new Date()
        const month = now.getUTCMonth() + 1
        const year = now.getUTCFullYear()

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
