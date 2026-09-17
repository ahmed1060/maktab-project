import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { calendarMonth } from "@/lib/time"

// Decimal.toJSON() returns a *string*, so a SalaryRecord/SalaryAdjustment
// passed straight into ApiResponse.success(...) would silently change these
// fields from numbers to strings on the wire — breaking any frontend code
// doing arithmetic or .toFixed() on them. Every method that returns one of
// these to a route converts through these first.
function serializeSalaryRecord<T extends { deductions: Prisma.Decimal; bonusDays: Prisma.Decimal; baseSalary: Prisma.Decimal }>(record: T) {
    return { ...record, deductions: Number(record.deductions), bonusDays: Number(record.bonusDays), baseSalary: Number(record.baseSalary) }
}

function serializeSalaryAdjustment<T extends { amount: Prisma.Decimal }>(adjustment: T) {
    return { ...adjustment, amount: Number(adjustment.amount) }
}

export class SalaryService {
    /**
     * Internal helper to ensure a salary record exists for a specific month/year.
     * Uses upsert to be safe during concurrent access.
     */
    static async ensureRecordExists(userId: string, month: number, year: number, baseSalary: number | Prisma.Decimal, tx?: any) {
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
        const { month: currentMonth, year: currentYear } = calendarMonth(now)

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

            // Typed (not any[]) on purpose: a record here used to union with
            // existingRecords into an untyped `any`, which silently hid a real
            // Decimal-arithmetic bug below (see netDays) from the compiler.
            type PendingSalaryRecord = {
                userId: string
                month: number
                year: number
                totalDays: number
                deductions: number
                bonusDays: number
                baseSalary: number | Prisma.Decimal
            }
            const recordsToCreate: PendingSalaryRecord[] = []

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
                    // deductions/bonusDays are Prisma.Decimal now (F-07), so Number()
                    // is required here: `-`/`+` on a Decimal object coerces it via
                    // .valueOf() (which decimal.js defines to return a *string*,
                    // deliberately, to stop exactly this kind of silent bug), which
                    // would make this string concatenation instead of subtraction.
                    // The old `recordsToCreate: any[]` typing would have hidden that
                    // from the compiler entirely — typed as PendingSalaryRecord[] above.
                    const netDays = prevRecord.totalDays - Number(prevRecord.deductions) + Number(prevRecord.bonusDays)
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

        const records = await prisma.salaryRecord.findMany({
            where: { userId },
            orderBy: [{ year: 'desc' }, { month: 'desc' }]
        })
        return records.map(serializeSalaryRecord)
    }

    static async addAdjustment(userId: string, type: 'BONUS' | 'DEDUCTION', amount: number, session: any, reason?: string) {
        const now = new Date()
        const { month: m, year: y } = calendarMonth(now)

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
                details: {
                    amount,
                    reason,
                    month: m,
                    year: y,
                    recordId: record.id,
                    targetUserId: userId
                }
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

            return serializeSalaryAdjustment(adjustment)
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
        const { month, year } = calendarMonth(date)

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
                details: {
                    adjId,
                    type: adjustment.type,
                    // Number(), not the raw Decimal — Decimal.toJSON() returns a
                    // string, which would silently change this audit field's type.
                    amount: Number(adjustment.amount),
                    originalReason: adjustment.reason,
                    targetUserId: userId
                }
            })

            return serializeSalaryAdjustment(updatedAdj)
        })
    }

    static async getAdjustments(userId: string) {
        const adjustments = await prisma.salaryAdjustment.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        })
        return adjustments.map(serializeSalaryAdjustment)
    }
}
