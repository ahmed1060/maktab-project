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
}
