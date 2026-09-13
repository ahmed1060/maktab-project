import { prisma } from "@/lib/prisma"
import { ObligationService } from "./obligation.service"
import { MaintenanceService } from "./maintenance.service"

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

    /**
     * Entry point for daily automated tasks.
     */
    static async dailyCheck() {
        console.log("[Cron] Running daily checks...")
        await this.resetDayOffCredits()
        await this.initializeSalaries()
        await MaintenanceService.cleanupOrphanedAssets()
        await MaintenanceService.pruneOldLogs(90)
        await MaintenanceService.pruneOldNotifications(30)
        await ObligationService.processRecurrentObligations()

        // Subscription lifecycle: grace beginning, grace ending, lockout, and a
        // trial about to run out. Runs here rather than in its own cron so it
        // shares the daily pass, and after the others so a company entering
        // lockout has already had its data written for the day — the plan is
        // explicit that background jobs keep running for locked companies,
        // since stopping them creates permanent gaps nobody can backfill.
        const { CompanyService } = await import("./company.service")
        await CompanyService.checkSubscriptionLifecycle()

        // --- NEW: Automated Note Expiry Checks ---
        const { NoteService } = await import("./note.service")
        await NoteService.checkExpiries()

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('SYSTEM_DAILY_CHECK', 'SYSTEM', 'CRON', {
            details: { timestamp: new Date().toISOString() }
        })
        console.log("[Cron] Daily checks completed.")
    }
}
