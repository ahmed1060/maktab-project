import { prisma } from "@/lib/prisma"

export class SalaryService {
    static async getHistory(userId: string) {
        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const currentYear = now.getFullYear()

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { salary: true }
        })
        const currentBaseSalary = user?.salary || 0

        const latestRecord = await prisma.salaryRecord.findFirst({
            where: { userId },
            orderBy: [{ year: 'desc' }, { month: 'desc' }]
        })

        if (!latestRecord) {
            const exists = await prisma.salaryRecord.findUnique({
                where: { userId_month_year: { userId, month: currentMonth, year: currentYear } }
            })
            if (!exists) {
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
                await prisma.salaryRecord.create({
                    data: {
                        userId,
                        month: currentMonth,
                        year: currentYear,
                        totalDays: daysInMonth,
                        deductions: 0,
                        baseSalary: currentBaseSalary
                    }
                })
            }
        } else {
            let iterYear = latestRecord.year
            let iterMonth = latestRecord.month

            while (true) {
                iterMonth++
                if (iterMonth > 12) {
                    iterMonth = 1
                    iterYear++
                }

                if (iterYear > currentYear || (iterYear === currentYear && iterMonth > currentMonth)) {
                    break
                }

                const exists = await prisma.salaryRecord.findUnique({
                    where: { userId_month_year: { userId, month: iterMonth, year: iterYear } }
                })

                if (!exists) {
                    let carryOverDeduction = 0
                    let prevM = iterMonth - 1
                    let prevY = iterYear
                    if (prevM === 0) {
                        prevM = 12
                        prevY--
                    }

                    const prevRecord = await prisma.salaryRecord.findUnique({
                        where: { userId_month_year: { userId, month: prevM, year: prevY } }
                    })

                    if (prevRecord) {
                        const netDays = prevRecord.totalDays - prevRecord.deductions + prevRecord.bonusDays
                        if (netDays < 0) {
                            carryOverDeduction = Math.abs(netDays)
                        }
                    }

                    const daysInIterMonth = new Date(iterYear, iterMonth, 0).getDate()
                    await prisma.salaryRecord.create({
                        data: {
                            userId,
                            month: iterMonth,
                            year: iterYear,
                            totalDays: daysInIterMonth,
                            deductions: carryOverDeduction,
                            baseSalary: currentBaseSalary
                        }
                    })
                }
            }
        }

        return await prisma.salaryRecord.findMany({
            where: { userId },
            orderBy: [{ year: 'desc' }, { month: 'desc' }]
        })
    }

    static async addAdjustment(userId: string, type: 'BONUS' | 'DEDUCTION', amount: number, reason?: string) {
        const now = new Date()
        const m = now.getMonth() + 1, y = now.getFullYear()

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { salary: true } })
        const currentBase = user?.salary || 0

        return await prisma.$transaction(async (tx) => {
            const existingRecord = await tx.salaryRecord.findUnique({
                where: { userId_month_year: { userId, month: m, year: y } }
            })

            if (existingRecord) {
                await tx.salaryRecord.update({
                    where: { id: existingRecord.id },
                    data: {
                        bonusDays: type === 'BONUS' ? { increment: amount } : undefined,
                        deductions: type === 'DEDUCTION' ? { increment: amount } : undefined
                    }
                })
            } else {
                await tx.salaryRecord.create({
                    data: {
                        userId, month: m, year: y,
                        totalDays: new Date(y, m, 0).getDate(),
                        deductions: type === 'DEDUCTION' ? amount : 0,
                        baseSalary: currentBase,
                        bonusDays: type === 'BONUS' ? amount : 0
                    }
                })
            }

            const adjustment = await tx.salaryAdjustment.create({
                data: { userId, type, amount, reason: reason || null, status: 'ACTIVE' }
            })

            await tx.notification.create({
                data: {
                    userId,
                    type: type === 'BONUS' ? 'BONUS_ADDED' : 'DEDUCTION_ADDED',
                    message: type === 'BONUS'
                        ? `Congratulations! You have received a bonus of ${amount} days.`
                        : `A deduction of ${amount} days has been applied to your record.`,
                    relatedId: userId
                }
            })

            return adjustment
        })
    }

    static async rollbackAdjustment(userId: string, adjId: string) {
        const adjustment = await prisma.salaryAdjustment.findUnique({
            where: { id: adjId }
        })

        if (!adjustment || adjustment.status === 'ROLLED_BACK') {
            throw new Error("INVALID_ADJUSTMENT")
        }

        const date = new Date(adjustment.createdAt)
        const month = date.getMonth() + 1
        const year = date.getFullYear()

        const record = await prisma.salaryRecord.findUnique({
            where: { userId_month_year: { userId, month, year } }
        })

        if (!record) throw new Error("RECORD_NOT_FOUND")

        return await prisma.$transaction(async (tx) => {
            const updatedAdj = await tx.salaryAdjustment.update({
                where: { id: adjId },
                data: { status: 'ROLLED_BACK' }
            })

            await tx.salaryRecord.update({
                where: { id: record.id },
                data: {
                    bonusDays: adjustment.type === 'BONUS' ? { decrement: adjustment.amount } : undefined,
                    deductions: adjustment.type === 'DEDUCTION' ? { decrement: adjustment.amount } : undefined
                }
            })

            return updatedAdj
        })
    }

    static async getAdjustments(userId: string) {
        return await prisma.salaryAdjustment.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        })
    }
}
