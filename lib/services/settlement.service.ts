import { prisma } from "@/lib/prisma"
import { previewSettlement, endOfContractInstant } from "@/lib/employment"
import { toMajor, valueDaysIn } from "@/lib/payroll"
import { calendarParts } from "@/lib/time"
import { nextPaydayOnOrAfter, daysAlreadyPaid } from "@/lib/payday"
import { resolveTimeZone } from "@/lib/timezone"
import { EmploymentService } from "./employment.service"
import { SalaryHistoryService } from "./salary-history.service"

/**
 * Producing the statement that ends an employment.
 *
 * P5 built the preview and said out loud that the half it could not build was
 * the refusal — "end contract cannot complete without a settlement" needs a
 * table to persist one into, and that table is this phase's. So this is where
 * that promise is kept: settleAndEnd does both in one transaction, and there is
 * no path that ends a contract without producing the document.
 *
 * The figures are frozen here rather than recomputed on read. A settlement is a
 * statement about a moment, and a salary change entered next week must not
 * quietly rewrite what somebody was told they were owed.
 */
export class SettlementService {
    /** The company's calendar and payroll day, resolved once. */
    private static async policyFor(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { companyId: true, company: { select: { payrollDay: true, timezone: true } } },
        })
        if (!user) throw new Error("USER_NOT_FOUND")

        const settings = await prisma.systemSettings.findUnique({
            where: { id: "default" },
            select: { defaultTimezone: true },
        })

        return {
            companyId: user.companyId,
            payrollDay: user.company?.payrollDay ?? 25,
            timeZone: resolveTimeZone(user.company?.timezone, settings?.defaultTimezone),
        }
    }

    /**
     * What ending on this date would settle at, with the paid figure worked out
     * rather than supplied.
     *
     * P5's pure preview took `paidMinor` as an argument because nothing knew
     * the payroll day yet. It does now: if payday has passed by the last
     * working day, the whole month has gone out, and the days after it that
     * were paid for and not worked are what the person owes back.
     */
    static async preview(userId: string, lastWorkingDay: string) {
        const { payrollDay, timeZone } = await this.policyFor(userId)
        const endsAt = endOfContractInstant(lastWorkingDay, timeZone)
        const { year, month } = calendarParts(endsAt, timeZone)

        const [events, rates] = await Promise.all([
            EmploymentService.history(userId),
            SalaryHistoryService.ratesForMonth(userId, year, month, timeZone),
        ])

        // The last day worked, as an instant inside that day, for the payday
        // comparison — endsAt is already the day after.
        const lastDayInstant = new Date(endsAt.getTime() - 1)
        const paidDays = daysAlreadyPaid(lastDayInstant, payrollDay, timeZone)
        const paidMinor = paidDays === 0
            ? 0
            : valueDaysIn(year, month, paidDays, rates[rates.length - 1].monthlyMinor)

        const preview = previewSettlement({ events, rates, endsAt, paidMinor, timeZone })

        return {
            ...preview,
            endsAt,
            payrollDay,
            timeZone,
            paydayHasPassed: paidDays > 0,
            dueDate: nextPaydayOnOrAfter(endsAt, payrollDay, timeZone),
        }
    }

    /**
     * End the contract and produce the settlement, or do neither.
     *
     * One transaction, deliberately. A contract ended with no statement leaves
     * somebody locked out and owed an amount nobody has written down; a
     * statement with no ended contract is a document about something that did
     * not happen. Both halves or nothing.
     */
    static async settleAndEnd(input: {
        userId: string
        lastWorkingDay: string
        reason?: string
        createdById?: string | null
    }) {
        const preview = await this.preview(input.userId, input.lastWorkingDay)
        const { companyId } = await this.policyFor(input.userId)
        if (!companyId) throw new Error("USER_HAS_NO_COMPANY")

        return prisma.$transaction(async (tx) => {
            const event = await EmploymentService.record({
                userId: input.userId,
                type: "CONTRACT_ENDED",
                effectiveFrom: preview.endsAt,
                reason: input.reason,
                createdById: input.createdById,
            }, tx)

            const settlement = await tx.finalSettlement.create({
                data: {
                    userId: input.userId,
                    companyId,
                    lastWorkingDay: new Date(preview.endsAt.getTime() - 1),
                    earnedAmount: toMajor(preview.earnedMinor),
                    paidAmount: toMajor(preview.paidMinor),
                    netAmount: toMajor(preview.netMinor),
                    dueDate: preview.dueDate,
                    reason: input.reason ?? null,
                    createdById: input.createdById ?? null,
                },
            })

            // A settlement the person owes is money to collect, and it joins the
            // one queue rather than living only inside a document somebody has
            // to remember to read.
            const debt = preview.netMinor < 0
                ? await tx.debt.create({
                    data: {
                        userId: input.userId,
                        companyId,
                        amount: toMajor(-preview.netMinor),
                        source: "SETTLEMENT",
                        sourceId: settlement.id,
                        dueDate: preview.dueDate,
                        reason: input.reason ?? null,
                    },
                })
                : null

            return { event, settlement, debt, preview }
        })
    }

    static async forUser(userId: string) {
        return prisma.finalSettlement.findMany({
            where: { userId },
            orderBy: { lastWorkingDay: "desc" },
        })
    }

    /** What is outstanding, oldest due first — a queue rather than a pile. */
    static async outstandingDebts(companyId: string) {
        return prisma.debt.findMany({
            where: { companyId, status: "OUTSTANDING" },
            orderBy: { dueDate: "asc" },
            include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        })
    }
}
