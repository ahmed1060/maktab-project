import { prisma } from "@/lib/prisma"
import { previewSettlement, endOfContractInstant } from "@/lib/employment"
import { toMajor, toMinor, valueDaysIn } from "@/lib/payroll"
import { planFinalRecovery, type RecoverableDebt } from "@/lib/debt-recovery"
import { calendarParts } from "@/lib/time"
import { nextPaydayOnOrAfter, daysAlreadyPaid } from "@/lib/payday"
import { resolveTimeZone } from "@/lib/timezone"
import { EmploymentService } from "./employment.service"
import { SalaryHistoryService } from "./salary-history.service"
import { TeamHandOff } from "./team-handoff.service"
import { notifyTeamMoves } from "./team-notify.service"
import { CASH_ADVANCE_DEBT, CashAdvanceService } from "./cash-advance.service"

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
     * What has actually gone out to this person for their final month.
     *
     * Reads the payslip rather than inferring from the calendar. Only a run
     * that is PAID counts: APPROVED means the figures are agreed and the money
     * has not moved, and a settlement that treats an unpaid month as paid bills
     * somebody for wages they never received.
     *
     * The net is the right figure because it is the amount that was actually
     * transferred — what a deduction took is not money they hold, and what the
     * run carried as a debt is already owed somewhere else and must not be
     * counted twice.
     *
     * Null rather than zero when there is no payslip at all: "the payroll run
     * paid them nothing" and "this company is not running payroll yet" are
     * different facts, and only the second one should fall back to a guess.
     */
    private static async paidForMonth(userId: string, year: number, month: number): Promise<
        | { source: "PAYSLIP"; minor: number }
        | { source: "RUN_NOT_PAID" }
        | { source: "NO_RUN" }
    > {
        const payslip = await prisma.payslip.findFirst({
            where: { userId, payrollRun: { year, month } },
            select: {
                netAmount: true,
                excluded: true,
                payrollRun: { select: { status: true } },
            },
        })

        // No run for this month at all. Either the company does not run payroll
        // through this system yet or the month has not been built, and the
        // calendar is genuinely the only thing there is to go on.
        if (!payslip) return { source: "NO_RUN" }

        // A run exists and says the money has not moved. Deliberately not
        // treated as "paid nothing": if payday has passed, a transfer may well
        // have gone out and simply not been recorded, and guessing either way
        // puts a wrong figure on somebody's final statement. It is called out
        // instead, because "mark the month paid first" is a thing a person can
        // actually do and takes a few seconds.
        if (payslip.payrollRun.status !== "PAID") return { source: "RUN_NOT_PAID" }

        // On the register to be seen, not to be paid. An excluded row is a
        // recorded decision that nothing went out — a fact, not a guess.
        if (payslip.excluded) return { source: "PAYSLIP", minor: 0 }

        return { source: "PAYSLIP", minor: toMinor(payslip.netAmount.toString()) }
    }

    /**
     * What ending on this date would settle at, with the paid figure read where
     * it can be and inferred only where it cannot.
     *
     * P5's pure preview took `paidMinor` as an argument because nothing knew
     * the payroll day yet, and P8's first version worked it out from the
     * calendar: if payday had passed, assume the whole month went out at the
     * rate in force. That assumption is wrong in the direction that overstates
     * what somebody received — it counts a month that was approved and never
     * paid, a person excluded from the run, a partial month, and a mid-month
     * rate change all as a full month's salary, and every one of those makes a
     * leaver owe back more than they should.
     *
     * P8 through P12 made it knowable. The inference survives only for a
     * company with no payroll run for that month, where there is genuinely
     * nothing to read, and the answer says which of the two it used so the
     * document can stop carrying a blanket caveat.
     */
    static async preview(userId: string, lastWorkingDay: string) {
        const { companyId, payrollDay, timeZone } = await this.policyFor(userId)
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

        const paid = await this.paidForMonth(userId, year, month)
        // The inference, kept for the two cases where nothing can be read.
        const assumedMinor = paidDays === 0
            ? 0
            : valueDaysIn(year, month, paidDays, rates[rates.length - 1].monthlyMinor)
        const paidMinor = paid.source === "PAYSLIP" ? paid.minor : assumedMinor

        const preview = previewSettlement({ events, rates, endsAt, paidMinor, timeZone })

        // I1: the settlement is the last moment either side can be made whole,
        // and it was the one moment the system did not look. A leaver owing
        // 3,000 and owed 8,000 was paid 8,000, and the 3,000 stayed outstanding
        // against somebody with no next month for recovery to take it from.
        //
        // Capped at what the settlement pays, so this can only ever reduce a
        // payment — never turn one into a demand. What it cannot reach stays a
        // debt, which is a thing somebody can chase or write off, rather than a
        // figure on a final statement telling a departing employee they owe
        // money.
        const dueDate = nextPaydayOnOrAfter(endsAt, payrollDay, timeZone)
        // What they still hold of a cash advance becomes a debt as the contract
        // ends (CLIENTS_PLAN.md §7.3), due with the settlement, and is recovered
        // from it as the debts already there are.
        const heldMinor = companyId ? toMinor((await CashAdvanceService.heldBy(companyId, userId)).toFixed(2)) : 0
        const debts = [
            ...await this.recoverableDebtsFor(userId),
            ...(heldMinor > 0 ? [{ id: CASH_ADVANCE_DEBT, outstandingMinor: heldMinor, dueDate }] : []),
        ]
        const recovery = planFinalRecovery({ netMinor: Math.max(0, preview.netMinor), debts })

        return {
            ...preview,
            endsAt,
            payrollDay,
            timeZone,
            // Kept as the calendar fact it always was — whether payday has come
            // round — rather than being redefined as "was anything paid". Two
            // different questions, and the screen asks the first one when it
            // explains why a figure lands the way it does.
            paydayHasPassed: paidDays > 0,
            // Which of the three this figure is, so the screen can say a true
            // thing rather than one blanket caveat: read from the payslip that
            // was paid, inferred because no run exists, or inferred while a run
            // for that month sits unpaid — the last being the one somebody
            // should resolve before signing anything.
            paidSource: paid.source,
            dueDate,
            /** What they still hold of a cash advance, which becomes a debt; in debtsOutstandingMinor too. */
            cashAdvanceHeldMinor: heldMinor,
            // The debt picture, reported separately from the employment
            // arithmetic above so the statement's own sums still add up.
            debtsOutstandingMinor: debts.reduce((sum, d) => sum + d.outstandingMinor, 0),
            debtRecoveredMinor: recovery.totalMinor,
            debtAllocations: recovery.allocations,
            /** What actually gets paid once the debts are taken. Never below zero. */
            payableMinor: Math.max(0, preview.netMinor) - recovery.totalMinor,
        }
    }

    /** Everything this person still owes, as the recovery planner needs it. */
    private static async recoverableDebtsFor(userId: string): Promise<RecoverableDebt[]> {
        const debts = await prisma.debt.findMany({
            where: { userId, status: "OUTSTANDING" },
            select: { id: true, amount: true, recoveredAmount: true, dueDate: true },
        })
        return debts
            .map(d => ({
                id: d.id,
                outstandingMinor: toMinor(d.amount.toString()) - toMinor(d.recoveredAmount.toString()),
                dueDate: d.dueDate,
            }))
            .filter(d => d.outstandingMinor > 0)
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
        /** Role of whoever is ending it, for the hand-off's audit entry. */
        actorRole?: string | null
        /** Their name, on the cash advance entry that becomes a debt. */
        actorName?: string | null
        /**
         * Where their team goes if they lead one: absent until somebody has
         * answered (refused with LEADER_HAS_REPORTS), null to leave them
         * unassigned, an id to move them. See TeamHandOff.
         */
        reassignReportsTo?: string | null
    }) {
        const preview = await this.preview(input.userId, input.lastWorkingDay)
        const { companyId } = await this.policyFor(input.userId)
        if (!companyId) throw new Error("USER_HAS_NO_COMPANY")

        // Ending a leader's contract takes them away from their team as surely
        // as demoting them does, and used to skip the question entirely: the
        // team stayed pointing at an archived account, visible to no leader.
        // Asked here rather than in the route, so no way of ending a contract
        // can skip it. Settled before anything is written — a refusal after
        // the settlement would be a statement for a contract that did not end.
        //
        // The team moves when the ending is recorded, not on the leaving date.
        // Until then the leader is still working, but from here on the team
        // needs somebody who will still be there after it.
        const rehome = await TeamHandOff.plan({ id: input.userId, companyId }, input.reassignReportsTo)

        const result = await prisma.$transaction(async (tx) => {
            if (rehome) {
                await TeamHandOff.apply(tx, input.userId, rehome, {
                    id: input.createdById ?? input.userId,
                    role: input.actorRole,
                })
            }

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
                    debtRecoveredAmount: toMajor(preview.debtRecoveredMinor),
                    dueDate: preview.dueDate,
                    reason: input.reason ?? null,
                    createdById: input.createdById ?? null,
                },
            })

            // What they still hold of a cash advance becomes a debt (CLIENTS_PLAN.md
            // §7.3), as much as the preview counted, and is paid down below as
            // its plan has it.
            const advanceDebt = await CashAdvanceService.toDebt(tx, companyId, input.userId, toMajor(preview.cashAdvanceHeldMinor), {
                dueDate: preview.dueDate,
                by: { id: input.createdById ?? input.userId, name: input.actorName },
            })

            // The debts this settlement paid down, closed here rather than left
            // for a recovery that will never come — the person has no next
            // month. Driven off the plan the preview produced, so the figure on
            // the statement and the figure taken are the same one.
            for (const allocation of preview.debtAllocations) {
                const debtId = allocation.debtId === CASH_ADVANCE_DEBT ? advanceDebt?.id : allocation.debtId
                const existing = debtId ? await tx.debt.findUnique({ where: { id: debtId } }) : null
                // Vanished or closed since the preview. Skipped rather than
                // failed: the settlement's own figures are already correct, and
                // refusing to end somebody's contract over a stale row helps
                // nobody.
                if (!existing || existing.status !== "OUTSTANDING") continue

                const recovered = Number(existing.recoveredAmount) + toMajor(allocation.amountMinor)
                await tx.debt.update({
                    where: { id: existing.id },
                    data: {
                        recoveredAmount: recovered,
                        ...(recovered >= Number(existing.amount) && {
                            status: "SETTLED",
                            settledAt: new Date(),
                        }),
                    },
                })
            }

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

            return { event, settlement, debt, advanceDebt, preview }
        })

        // News, after the commit, as every other hand-off does it.
        await notifyTeamMoves(TeamHandOff.moves(input.userId, rehome))

        return result
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
