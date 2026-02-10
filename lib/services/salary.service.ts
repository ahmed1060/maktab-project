import { prisma } from "@/lib/prisma"

export class SalaryService {
    /**
     * Internal helper to ensure a salary record exists for a specific month/year.
     * Uses upsert to be safe during concurrent access.
     */
    static async ensureRecordExists(userId: string, month: number, year: number, baseSalary: number, tx?: any) {
        const prismaClient = tx || prisma
        const daysInMonth = new Date(year, month, 0).getDate()

        return await prismaClient.salaryRecord.upsert({
            where: { userId_month_year: { userId, month, year } },
            update: {}, // Do nothing if it exists
            create: {
                userId,
                month,
                year,
                totalDays: daysInMonth,
                baseSalary: baseSalary,
                deductions: 0,
                bonusDays: 0
            }
        })
    }

    static async getHistory(userId: string) {
        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const currentYear = now.getFullYear()

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { salary: true }
        })
        const currentBaseSalary = user?.salary || 0

        // 1. Fetch existing records efficiently
        const existingRecords = await prisma.salaryRecord.findMany({
            where: { userId },
            orderBy: [{ year: 'asc' }, { month: 'asc' }]
        })

        if (existingRecords.length === 0) {
            await this.ensureRecordExists(userId, currentMonth, currentYear, currentBaseSalary)
        } else {
            const existingSet = new Set(existingRecords.map(r => `${r.year}-${r.month}`))
            const latestRecord = existingRecords[existingRecords.length - 1]
            let iterYear = latestRecord.year
            let iterMonth = latestRecord.month

            const recordsToCreate: any[] = []

            // Sequential gap filling logic
            while (true) {
                // Move to next month
                iterMonth++
                if (iterMonth > 12) {
                    iterMonth = 1; iterYear++
                }

                if (iterYear > currentYear || (iterYear === currentYear && iterMonth > currentMonth)) {
                    break
                }

                if (existingSet.has(`${iterYear}-${iterMonth}`)) continue

                // Check carry over from PREVIOUS month (sequential)
                let carryOverDeduction = 0
                let prevM = iterMonth - 1
                let prevY = iterYear
                if (prevM === 0) { prevM = 12; prevY-- }

                const prevRecord = existingRecords.find(r => r.month === prevM && r.year === prevY) ||
                    recordsToCreate.find(r => r.month === prevM && r.year === prevY)

                if (prevRecord) {
                    const netDays = prevRecord.totalDays - prevRecord.deductions + prevRecord.bonusDays
                    if (netDays < 0) carryOverDeduction = Math.abs(netDays)
                }

                const newRecord = {
                    userId,
                    month: iterMonth,
                    year: iterYear,
                    totalDays: new Date(iterYear, iterMonth, 0).getDate(),
                    deductions: carryOverDeduction,
                    bonusDays: 0,
                    baseSalary: currentBaseSalary
                }

                await prisma.salaryRecord.create({ data: newRecord })
                recordsToCreate.push(newRecord)
            }
        }

        return await prisma.salaryRecord.findMany({
            where: { userId },
            orderBy: [{ year: 'desc' }, { month: 'desc' }]
        })
    }

    static async addAdjustment(userId: string, type: 'BONUS' | 'DEDUCTION', amount: number, session: any, reason?: string) {
        const now = new Date()
        const m = now.getMonth() + 1, y = now.getFullYear()

        if (amount <= 0 || amount > 1000) {
            throw new Error("INVALID_ADJUSTMENT_AMOUNT")
        }

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { salary: true } })
        const currentBase = user?.salary || 0

        return await prisma.$transaction(async (tx) => {
            // Atomic initialization/fetch of the record
            const record = await this.ensureRecordExists(userId, m, y, currentBase, tx)

            // Update record counts
            await tx.salaryRecord.update({
                where: { id: record.id },
                data: {
                    bonusDays: type === 'BONUS' ? { increment: amount } : undefined,
                    deductions: type === 'DEDUCTION' ? { increment: amount } : undefined
                }
            })

            const adjustment = await tx.salaryAdjustment.create({
                data: { userId, type, amount, reason: reason || null, status: 'ACTIVE' }
            })

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log(type === 'BONUS' ? 'ADD_BONUS' : 'ADD_DEDUCTION', 'SALARY', userId, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: { amount, reason, month: m, year: y, recordId: record.id }
            })

            const { NotificationService } = await import("./notification.service")
            await NotificationService.notify(
                userId,
                type === 'BONUS' ? 'BONUS_ADDED' : 'DEDUCTION_ADDED',
                type === 'BONUS'
                    ? `Congratulations! You have received a bonus of ${amount} days.`
                    : `A deduction of ${amount} days has been applied to your record.`,
                userId,
                tx
            )

            return adjustment
        })
    }

    static async rollbackAdjustment(userId: string, adjId: string, session: any) {
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

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('ROLLBACK_SALARY_ADJUSTMENT', 'SALARY', userId, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: { adjId, type: adjustment.type, amount: adjustment.amount, originalReason: adjustment.reason }
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
