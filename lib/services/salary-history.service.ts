import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { ratesForMonth, rateAt, effectiveFromChoice, type EffectiveChoice } from "@/lib/salary-history"
import type { RateChange } from "@/lib/payroll"

/**
 * The one writer for a person's salary.
 *
 * Both halves move together or neither does. User.salary is the rate every
 * existing screen reads; SalaryChange is what happened. Letting them drift is
 * the failure this class exists to prevent — a payslip computed from history
 * that disagrees with the number an admin is looking at is a dispute nobody can
 * settle, because both sides are reading a true value from a different place.
 *
 * So every write goes through record(), in a transaction, and User.salary is
 * only touched when the change is in force now. A raise effective next month
 * must not move this month's displayed salary; it is a fact about October
 * recorded in September, and the history is where facts about the future live.
 */
export class SalaryHistoryService {
    /**
     * Record a new salary.
     *
     * `effectiveFrom` is usually built by effectiveFromChoice from the
     * this-month-or-next prompt, but any date is allowed: a correction entered
     * late needs to be dated when it actually took effect, not when somebody
     * got round to typing it.
     */
    static async record(
        input: {
            userId: string
            monthlyAmount: number
            effectiveFrom: Date
            reason?: string
            createdById?: string | null
        },
        tx?: Prisma.TransactionClient,
    ) {
        const run = async (client: Prisma.TransactionClient) => {
            const change = await client.salaryChange.create({
                data: {
                    userId: input.userId,
                    monthlyAmount: input.monthlyAmount,
                    effectiveFrom: input.effectiveFrom,
                    reason: input.reason ?? null,
                    createdById: input.createdById ?? null,
                },
            })

            // Only when it is already in force. A future-dated change leaves the
            // current rate alone until the month it belongs to arrives.
            if (input.effectiveFrom.getTime() <= Date.now()) {
                await client.user.update({
                    where: { id: input.userId },
                    data: { salary: input.monthlyAmount },
                })
            }

            return change
        }

        if (tx) return run(tx)
        const out = await prisma.$transaction(run)
        // Attendance prices days at the salary, and only while employed, in force on them.
        const { recomputeForPersonFrom } = await import("./attendance-recompute")
        await recomputeForPersonFrom(input.userId, input.effectiveFrom)
        return out
    }

    /** Convenience over record() for the prompt's two answers. */
    static async recordFromChoice(
        input: {
            userId: string
            monthlyAmount: number
            choice: EffectiveChoice
            reason?: string
            createdById?: string | null
            timeZone?: string
        },
        tx?: Prisma.TransactionClient,
    ) {
        return this.record({
            ...input,
            effectiveFrom: effectiveFromChoice(new Date(), input.choice, input.timeZone),
        }, tx)
    }

    /** Everything on record for a person, oldest first. */
    static async history(userId: string) {
        return prisma.salaryChange.findMany({
            where: { userId },
            orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
        })
    }

    /**
     * The rates a month is split on, ready for splitMonth().
     *
     * Reads the whole history rather than a window: ratesForMonth needs the
     * latest change *before* the month to know what rate it opens on, and a
     * query bounded to the month would lose exactly that row. A person's salary
     * history is a handful of rows, so there is nothing to optimise away here.
     */
    static async ratesForMonth(
        userId: string,
        year: number,
        month: number,
        timeZone?: string,
    ): Promise<RateChange[]> {
        const changes = await this.history(userId)
        return ratesForMonth(
            changes.map(c => ({
                monthlyAmount: c.monthlyAmount.toString(),
                effectiveFrom: c.effectiveFrom,
                reason: c.reason,
                createdAt: c.createdAt,
            })),
            year,
            month,
            timeZone,
        )
    }

    /** The rate in force at an instant — for a screen, or a one-day valuation. */
    static async rateAt(userId: string, at: Date) {
        const changes = await this.history(userId)
        return rateAt(
            changes.map(c => ({
                monthlyAmount: c.monthlyAmount.toString(),
                effectiveFrom: c.effectiveFrom,
                reason: c.reason,
                createdAt: c.createdAt,
            })),
            at,
        )
    }
}
