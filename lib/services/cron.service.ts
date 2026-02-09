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

                    // Audit Log (System)
                    await tx.auditLog.create({
                        data: {
                            action: 'SYSTEM_DAY_OFF_RESET',
                            entityType: 'USER',
                            entityId: user.id,
                            details: JSON.stringify({ oldYear: user.lastDayOffResetYear, newYear: currentYear, creditWas: user.dayOffCredit, creditNow: user.baseDayOffCredit })
                        }
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
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

        const employees = await prisma.user.findMany({
            where: {
                status: { not: 'DELETED' },
                role: { in: ['EMPLOYEE', 'TEAM_LEADER', 'ADMIN'] }
            },
            select: { id: true, salary: true }
        })

        let createdCount = 0
        let skippedCount = 0

        for (const employee of employees) {
            try {
                const existing = await prisma.salaryRecord.findUnique({
                    where: { userId_month_year: { userId: employee.id, month, year } }
                })

                if (!existing) {
                    await prisma.salaryRecord.create({
                        data: {
                            userId: employee.id,
                            month, year,
                            totalDays: daysInMonth,
                            baseSalary: employee.salary || 0,
                            deductions: 0,
                            bonusDays: 0
                        }
                    })

                    // Audit Log (System)
                    await prisma.auditLog.create({
                        data: {
                            action: 'SYSTEM_SALARY_INIT',
                            entityType: 'SALARY',
                            entityId: employee.id,
                            details: JSON.stringify({ month, year, baseSalary: employee.salary })
                        }
                    })
                    createdCount++
                } else {
                    skippedCount++
                }
            } catch (err) {
                console.error(`Failed to init salary for user ${employee.id}:`, err)
            }
        }

        return { success: true, month, year, created: createdCount, skipped: skippedCount }
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

        // Audit Log (System Summary)
        await prisma.auditLog.create({
            data: {
                action: 'SYSTEM_DAILY_CHECK',
                entityType: 'SYSTEM',
                entityId: 'CRON',
                details: JSON.stringify({ timestamp: new Date().toISOString() })
            }
        })
        console.log("[Cron] Daily checks completed.")
    }
}
