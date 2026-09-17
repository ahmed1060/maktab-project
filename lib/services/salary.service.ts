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

/** Where an adjustment came from. Stored, so nothing has to guess later. */
export type AdjustmentSource = "MANUAL" | "TASK_PENALTY" | "DAY_OFF" | "SETTLEMENT"

/**
 * The two statuses that end an adjustment's life, and they are not the same
 * thing.
 *
 * ROLLED_BACK is "this should never have existed" — a mis-keyed amount, the
 * wrong person. REVERSED is "this was correct when it was made, and is now
 * being undone" — a penalty appealed, a deduction waived. Both remove the days
 * from the month they landed on; they differ in what they say to whoever reads
 * the history a year later, which is the only reason anybody reads it.
 *
 * Both are terminal, and both have to be guarded. Guarding one and not the
 * other is how an adjustment gets undone twice, and the second undo credits
 * days that were never taken.
 */
export const TERMINAL_ADJUSTMENT_STATUSES = ["ROLLED_BACK", "REVERSED"] as const
export type TerminalAdjustmentStatus = typeof TERMINAL_ADJUSTMENT_STATUSES[number]

export function isTerminalAdjustment(status: string): boolean {
    return (TERMINAL_ADJUSTMENT_STATUSES as readonly string[]).includes(status)
}

/** The sanity bound on a day-denominated adjustment, from any source. */
const MAX_ADJUSTMENT_DAYS = 1000

export class SalaryService {
    /**
     * Ensure a salary record exists for a month. Upsert, so concurrent callers
     * cannot create two.
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

    /**
     * What a month's salary was, for a record being created now.
     *
     * The salary history knows; User.salary only knows today. For the current
     * month those agree, and for any earlier one they do not — which matters
     * now that an adjustment can be filed against a past month at all. Falls
     * back to User.salary when there is no history covering that month, because
     * a missing rate must not stop a deduction being recorded.
     */
    private static async baseSalaryFor(userId: string, month: number, year: number): Promise<number> {
        try {
            const { SalaryHistoryService } = await import("./salary-history.service")
            const rates = await SalaryHistoryService.ratesForMonth(userId, year, month)
            // The rate the month opens on. A mid-month change splits the month for
            // payroll, but a SalaryRecord carries one figure.
            return rates[0].monthlyMinor / 100
        } catch {
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { salary: true } })
            return Number(user?.salary || 0)
        }
    }

    /**
     * The one door through which a bonus or deduction reaches a salary record.
     *
     * Four paths used to write adjustments — a manual bonus, a manual
     * deduction, a task penalty and a day-off deduction — and each computed its
     * own month, incremented its own record and wrote its own row. Two of them
     * also hand-rolled the find-or-create, with their own idea of how many days
     * a month has and where a base salary comes from. Nothing recorded which
     * record an adjustment had actually touched, so undoing one re-derived the
     * month from the write time and hoped it matched.
     *
     * Now the period is an argument, defaulting to the current month, and it is
     * stored on the row. An adjustment for a month that has already passed is
     * ordinary rather than inexpressible, and an undo reads where the days went
     * instead of guessing.
     */
    static async applyAdjustment(
        input: {
            userId: string
            type: "BONUS" | "DEDUCTION"
            amount: number
            source: AdjustmentSource
            sourceId?: string | null
            reason?: string | null
            /** Defaults to the current calendar month. */
            month?: number
            year?: number
            /** Skips the salary lookup when the caller already has it. */
            baseSalary?: number | Prisma.Decimal
        },
        tx?: Prisma.TransactionClient,
    ) {
        // One bound, at the one door. A day count outside this range is not a
        // policy question, it is a typo or a unit mix-up, and it used to be
        // checked on the manual path only — so the two automated paths could
        // write anything at all into a salary record.
        if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_ADJUSTMENT_DAYS) {
            throw new Error("INVALID_ADJUSTMENT_AMOUNT")
        }

        const period = input.month != null && input.year != null
            ? { month: input.month, year: input.year }
            : calendarMonth(new Date())

        const baseSalary = input.baseSalary ?? await this.baseSalaryFor(input.userId, period.month, period.year)

        const run = async (client: Prisma.TransactionClient) => {
            const record = await this.ensureRecordExists(
                input.userId, period.month, period.year, baseSalary, client,
            )

            await client.salaryRecord.update({
                where: { id: record.id },
                data: {
                    bonusDays: input.type === "BONUS" ? { increment: input.amount } : undefined,
                    deductions: input.type === "DEDUCTION" ? { increment: input.amount } : undefined,
                },
            })

            const adjustment = await client.salaryAdjustment.create({
                data: {
                    userId: input.userId,
                    type: input.type,
                    amount: input.amount,
                    reason: input.reason ?? null,
                    status: "ACTIVE",
                    month: period.month,
                    year: period.year,
                    source: input.source,
                    sourceId: input.sourceId ?? null,
                },
            })

            return { adjustment, record, month: period.month, year: period.year }
        }

        return tx ? run(tx) : prisma.$transaction(run)
    }

    /**
     * Every month from the first record to this one, so a history has no holes.
     *
     * Split out of getHistory, which used to do this on a GET. A read that
     * creates rows is a read that behaves differently the second time it is
     * called, cannot be cached, and quietly writes to the database from a
     * dashboard render. The gap filling is real work and still happens — it is
     * just named now, and called deliberately.
     */
    static async ensureRecordsThrough(userId: string) {
        const { month: currentMonth, year: currentYear } = calendarMonth(new Date())

        const existingRecords = await prisma.salaryRecord.findMany({
            where: { userId },
            orderBy: [{ year: "asc" }, { month: "asc" }],
        })

        if (existingRecords.length === 0) {
            await this.ensureRecordExists(
                userId, currentMonth, currentYear,
                await this.baseSalaryFor(userId, currentMonth, currentYear),
            )
            return
        }

        const existingSet = new Set(existingRecords.map(r => `${r.year}-${r.month}`))
        const latest = existingRecords[existingRecords.length - 1]
        let iterYear = latest.year
        let iterMonth = latest.month

        // Typed on purpose: these used to union with existingRecords into an
        // untyped any[], which hid a real Decimal-arithmetic bug below from the
        // compiler (see netDays).
        type PendingSalaryRecord = {
            month: number
            year: number
            totalDays: number
            deductions: number
            bonusDays: number
        }
        const created: PendingSalaryRecord[] = []

        while (true) {
            iterMonth++
            if (iterMonth > 12) { iterMonth = 1; iterYear++ }

            if (iterYear > currentYear || (iterYear === currentYear && iterMonth > currentMonth)) break
            if (existingSet.has(`${iterYear}-${iterMonth}`)) continue

            let prevM = iterMonth - 1
            let prevY = iterYear
            if (prevM === 0) { prevM = 12; prevY-- }

            const prevRecord = existingRecords.find(r => r.month === prevM && r.year === prevY)
                ?? created.find(r => r.month === prevM && r.year === prevY)

            // A month whose deductions exceed its days carries the shortfall
            // forward rather than paying a negative salary.
            let carryOverDeduction = 0
            if (prevRecord) {
                // Number(), not arithmetic on the Decimal: decimal.js defines
                // valueOf() to return a *string*, deliberately, so `-` on two
                // of these would concatenate instead of subtract.
                const netDays = prevRecord.totalDays - Number(prevRecord.deductions) + Number(prevRecord.bonusDays)
                if (netDays < 0) carryOverDeduction = Math.abs(netDays)
            }

            const totalDays = new Date(iterYear, iterMonth, 0).getDate()

            // The month's own rate, not today's. Backfilling a year of history
            // at the current salary would state, in a column payroll reads, that
            // somebody has always earned what they earn now.
            await this.ensureRecordExists(
                userId, iterMonth, iterYear,
                await this.baseSalaryFor(userId, iterMonth, iterYear),
            )

            if (carryOverDeduction > 0) {
                await prisma.salaryRecord.update({
                    where: { userId_month_year: { userId, month: iterMonth, year: iterYear } },
                    data: { deductions: { increment: carryOverDeduction } },
                })
            }

            created.push({ month: iterMonth, year: iterYear, totalDays, deductions: carryOverDeduction, bonusDays: 0 })
        }
    }

    /** A read. Call ensureRecordsThrough first if the gaps matter. */
    static async getHistory(userId: string) {
        const records = await prisma.salaryRecord.findMany({
            where: { userId },
            orderBy: [{ year: "desc" }, { month: "desc" }],
        })
        return records.map(serializeSalaryRecord)
    }

    /** A manual bonus or deduction, entered by an admin. */
    static async addAdjustment(
        userId: string,
        type: "BONUS" | "DEDUCTION",
        amount: number,
        session: any,
        reason?: string,
        period?: { month: number; year: number },
    ) {
        if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ADJUSTMENT_DAYS) {
            throw new Error("INVALID_ADJUSTMENT_AMOUNT")
        }

        return await prisma.$transaction(async (tx) => {
            const { adjustment, record, month, year } = await this.applyAdjustment({
                userId,
                type,
                amount,
                source: "MANUAL",
                reason: reason || null,
                month: period?.month,
                year: period?.year,
            }, tx)

            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log(type === 'BONUS' ? 'ADD_BONUS' : 'ADD_DEDUCTION', 'SALARY', userId, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: {
                    amount,
                    reason,
                    month,
                    year,
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

    /**
     * Take an adjustment back off the month it landed on.
     *
     * Shared by rollback and reversal, which differ only in what they mean and
     * in what they write to the audit trail. The period comes off the row, so
     * the days are removed from the record they were added to — at that month's
     * rate, because that is the month whose day-value they were worth. The old
     * code re-derived the month from createdAt, which is the same answer right
     * up until it is not.
     */
    private static async undoAdjustment(
        userId: string,
        adjId: string,
        session: any,
        outcome: TerminalAdjustmentStatus,
        auditAction: string,
        reason?: string,
    ) {
        const adjustment = await prisma.salaryAdjustment.findUnique({ where: { id: adjId } })

        if (!adjustment || adjustment.userId !== userId) throw new Error("INVALID_ADJUSTMENT")
        // Both terminal statuses, not just the one that existed first. An
        // adjustment undone twice credits back days that were only ever taken
        // once.
        if (isTerminalAdjustment(adjustment.status)) throw new Error("INVALID_ADJUSTMENT")

        const record = await prisma.salaryRecord.findUnique({
            where: { userId_month_year: { userId, month: adjustment.month, year: adjustment.year } }
        })

        if (!record) throw new Error("RECORD_NOT_FOUND")

        return await prisma.$transaction(async (tx) => {
            const updatedAdj = await tx.salaryAdjustment.update({
                where: { id: adjId },
                data: { status: outcome },
            })

            await tx.salaryRecord.update({
                where: { id: record.id },
                data: {
                    bonusDays: adjustment.type === 'BONUS' ? { decrement: adjustment.amount } : undefined,
                    deductions: adjustment.type === 'DEDUCTION' ? { decrement: adjustment.amount } : undefined
                }
            })

            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log(auditAction, 'SALARY', userId, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: {
                    adjId,
                    type: adjustment.type,
                    // Number(), not the raw Decimal — Decimal.toJSON() returns a
                    // string, which would silently change this audit field's type.
                    amount: Number(adjustment.amount),
                    month: adjustment.month,
                    year: adjustment.year,
                    source: adjustment.source,
                    originalReason: adjustment.reason,
                    reversalReason: reason ?? null,
                    targetUserId: userId
                }
            })

            return serializeSalaryAdjustment(updatedAdj)
        })
    }

    /** This should never have existed: a mis-keyed amount, the wrong person. */
    static async rollbackAdjustment(userId: string, adjId: string, session: any) {
        return this.undoAdjustment(userId, adjId, session, "ROLLED_BACK", "ROLLBACK_SALARY_ADJUSTMENT")
    }

    /**
     * This was right, and is now being undone: a penalty appealed, a deduction
     * waived. Audited under its own action so the history can still say which
     * of the two happened.
     */
    static async reverseAdjustment(userId: string, adjId: string, session: any, reason?: string) {
        return this.undoAdjustment(userId, adjId, session, "REVERSED", "REVERSE_SALARY_ADJUSTMENT", reason)
    }

    static async getAdjustments(userId: string) {
        const adjustments = await prisma.salaryAdjustment.findMany({
            where: { userId },
            orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }]
        })
        return adjustments.map(serializeSalaryAdjustment)
    }
}
