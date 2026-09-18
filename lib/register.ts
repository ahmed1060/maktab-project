/**
 * Turning a month into what each person is paid, and then into the one screen
 * somebody has to sign off.
 *
 * Pure, like everything it builds on. A register is the last point at which a
 * mistake is cheap: after approval the figures are frozen and the next step is
 * money leaving. So the calculation that produces it has to be checkable against
 * worked examples rather than against whatever happens to be in the database.
 *
 * It composes the three phases underneath rather than re-deriving them —
 * employment.ts says which days are payable, salary-history.ts says at what
 * rate, payroll.ts does the arithmetic in minor units — and adds only what is
 * genuinely new: adjustments as lines, and the aggregates a reviewer reads.
 */

import {
    splitMonth, valueSegment, valueDayQuantity, daysInMonth, totalPayslip,
    type Minor, type RateChange, type PayslipLine, type PayslipTotals,
} from "./payroll"
import { payableWindows, undecidedDays, employedWholeMonth, type MonthTimeline } from "./employment"
import { planRecovery, recoveryLabel, DEBT_RECOVERY_SOURCE, FULL_RECOVERY_PERCENT, type RecoverableDebt } from "./debt-recovery"

/** A payslip line, plus where it came from, so a disputed figure is traceable. */
export interface RegisterLine extends PayslipLine {
    source: string
    sourceId?: string | null
    sortOrder: number
}

/** An adjustment as stored: a count of days, against a month. */
export interface AdjustmentInput {
    type: "BONUS" | "DEDUCTION"
    /** Days, not money. Valued below at the month's own day rate. */
    days: number
    reason?: string | null
    source: string
    sourceId?: string | null
}

export interface PersonMonth {
    userId: string
    name: string
    timeline: MonthTimeline
    /** As ratesForMonth returns them: at least one, opening on day 1. */
    rates: RateChange[]
    adjustments: AdjustmentInput[]
    /** Present when this person is deliberately left out of the run. */
    exclusion?: { reason: string }
    /** What this person still owes, for recovery out of this month's net. */
    debts?: RecoverableDebt[]
    /** The company's cap, as a percentage of net. Absent means the whole net. */
    recoveryCapPercent?: number
    /**
     * The last instant of this month in the company's calendar; debts due after
     * it are left alone.
     *
     * Carried per person because that is the shape buildEntry receives, though
     * like the cap it is really a fact about the run. It is passed in rather
     * than derived here because deriving it needs the company's time zone, and
     * a UTC month end is two or three hours adrift of a Cairo one — enough to
     * collect a debt a day before it is owed.
     */
    debtsDueOnOrBefore?: Date
}

export interface RegisterEntry {
    userId: string
    name: string
    lines: RegisterLine[]
    totals: PayslipTotals
    daysPaid: number
    wholeMonth: boolean
    /**
     * Days under a suspension nobody has ruled on. Paid, and counted here, so
     * the register can say this month is not finished being decided rather than
     * presenting its total as settled.
     */
    undecidedDays: number
    excluded: boolean
    exclusionReason?: string
}

/**
 * What a day of this month is worth for an adjustment.
 *
 * The rate in force at the end of the month, which is the rate the person is on
 * when the payslip is produced and the one they would expect a day to be valued
 * at. It is only ever a question when a salary changed mid-month, because then
 * "two days' pay" has two possible answers and the adjustment records a month
 * but not a day. Giving adjustments a day would make this exact; until
 * something needs that, this is the rule, and it is written down rather than
 * left to whichever rate a loop happened to end on.
 */
function adjustmentRate(rates: RateChange[]): Minor {
    return rates[rates.length - 1].monthlyMinor
}

/** One person's payslip for one month. */
export function buildEntry(person: PersonMonth): RegisterEntry {
    const { year, month } = person.timeline
    const lines: RegisterLine[] = []
    let daysPaid = 0

    if (person.rates.length === 0) {
        throw new Error(`No salary in effect for ${person.name} in ${year}-${String(month).padStart(2, "0")}`)
    }

    // Worked days, at the rate in force across each stretch of them. A month
    // with a mid-month raise produces two lines, which is what makes a payslip
    // explain itself rather than just assert a number.
    for (const window of payableWindows(person.timeline)) {
        for (const segment of splitMonth(year, month, person.rates, window)) {
            const days = segment.toDay - segment.fromDay + 1
            daysPaid += days
            lines.push({
                kind: "EARNING",
                label: segment.fromDay === 1 && segment.toDay === daysInMonth(year, month)
                    ? "Salary"
                    : `Salary, days ${segment.fromDay}–${segment.toDay}`,
                amountMinor: valueSegment(segment),
                source: "SALARY",
                sortOrder: segment.fromDay,
            })
        }
    }

    const dayRate = adjustmentRate(person.rates)
    let order = 100
    for (const adjustment of person.adjustments) {
        // A quantity of days, not a window of the month: an adjustment may
        // exceed the month's length, and the excess becomes debt.
        const amountMinor = valueDayQuantity(year, month, adjustment.days, dayRate)
        // A zero-value adjustment is a line that explains nothing and adds
        // nothing; it is dropped rather than printed as 0.00.
        if (amountMinor === 0) continue
        lines.push({
            kind: adjustment.type === "BONUS" ? "EARNING" : "DEDUCTION",
            label: adjustment.reason?.trim()
                || (adjustment.type === "BONUS" ? "Bonus" : "Deduction"),
            amountMinor,
            source: adjustment.source,
            sourceId: adjustment.sourceId ?? null,
            sortOrder: order++,
        })
    }

    // Recovery runs last, against the net rather than alongside the other
    // deductions, and that ordering is the whole of its safety. Added to the
    // list before totalPayslip and it would be floored like anything else — a
    // recovery big enough to exceed the net would carry, turning one debt into
    // two and charging interest in the form of a second row. Capped at what is
    // actually there, it can only ever reduce the net to zero.
    //
    // Excluded people are skipped: nothing is being paid, so there is nothing
    // to take, and a recovery line on a payslip that pays nothing would be a
    // claim that money moved.
    const beforeRecovery = totalPayslip(lines)
    if (!person.exclusion && person.debts?.length) {
        const plan = planRecovery({
            netMinor: beforeRecovery.netMinor,
            debts: person.debts,
            capPercent: person.recoveryCapPercent ?? FULL_RECOVERY_PERCENT,
            // Anything due after this month has not come round yet. Taking it
            // early is the company deciding its own terms were earlier than it
            // said they were.
            dueOnOrBefore: person.debtsDueOnOrBefore ?? endOfMonthInstant(year, month),
        })
        for (const allocation of plan.allocations) {
            const debt = person.debts.find(d => d.id === allocation.debtId)!
            lines.push({
                kind: "DEDUCTION",
                label: recoveryLabel(allocation.amountMinor < debt.outstandingMinor),
                amountMinor: allocation.amountMinor,
                source: DEBT_RECOVERY_SOURCE,
                sourceId: allocation.debtId,
                sortOrder: order++,
            })
        }
    }

    return {
        userId: person.userId,
        name: person.name,
        lines,
        totals: totalPayslip(lines),
        daysPaid,
        wholeMonth: employedWholeMonth(person.timeline),
        undecidedDays: undecidedDays(person.timeline),
        excluded: Boolean(person.exclusion),
        exclusionReason: person.exclusion?.reason,
    }
}

/**
 * The last instant of a month in UTC, for deciding which debts have come due.
 *
 * Only the fallback: a caller that knows the company's zone passes its own, and
 * the service always does. Built from the month's own length rather than by
 * stepping back from the 1st of the next one, so December needs no special case.
 */
function endOfMonthInstant(year: number, month: number): Date {
    return new Date(Date.UTC(year, month - 1, daysInMonth(year, month), 23, 59, 59, 999))
}

export interface PendingDecision {
    userId: string
    name: string
    undecidedDays: number
}

export interface Register {
    year: number
    /** 1-12. */
    month: number
    entries: RegisterEntry[]
    /** What will actually be paid: the nets of everybody not excluded. */
    payableMinor: Minor
    /** What the deductions could not take, and so becomes debt. */
    carriedMinor: Minor
    includedCount: number
    excludedCount: number
    /**
     * People whose month turns on a question nobody has answered. The register
     * shows its total either way — an unanswered question must not silently
     * become a deduction — but it says so, because a figure presented as
     * settled when it is not is the one thing a sign-off screen must not do.
     */
    pendingDecisions: PendingDecision[]
}

export function buildRegister(people: PersonMonth[], year: number, month: number): Register {
    const entries = people.map(buildEntry)
    const included = entries.filter(e => !e.excluded)

    return {
        year,
        month,
        entries,
        payableMinor: included.reduce((sum, e) => sum + e.totals.netMinor, 0),
        carriedMinor: included.reduce((sum, e) => sum + e.totals.carriedMinor, 0),
        includedCount: included.length,
        excludedCount: entries.length - included.length,
        pendingDecisions: entries
            .filter(e => !e.excluded && e.undecidedDays > 0)
            .map(e => ({ userId: e.userId, name: e.name, undecidedDays: e.undecidedDays })),
    }
}

export interface PersonVariance {
    userId: string
    name: string
    previousMinor: Minor | null
    currentMinor: Minor | null
    deltaMinor: Minor
    /** New this month, gone since last month, or a figure that moved. */
    kind: "NEW" | "GONE" | "CHANGED" | "SAME"
}

export interface Variance {
    previousTotalMinor: Minor
    currentTotalMinor: Minor
    deltaMinor: Minor
    people: PersonVariance[]
}

/**
 * What changed since last month, per person and in total.
 *
 * The question a reviewer actually asks is not "is this number right" — it is
 * unknowable from one screen — but "why is it different from last month". So
 * the register answers that one, and answers it per person, because a total
 * that matches while two people's pay swapped is a total that tells you
 * nothing.
 *
 * Somebody who has left appears as GONE with a negative delta rather than
 * vanishing. A row that disappears is the change nobody sees.
 */
export function variance(
    current: RegisterEntry[],
    previous: { userId: string; name: string; netMinor: Minor }[],
): Variance {
    const before = new Map(previous.map(p => [p.userId, p]))
    const after = new Map(current.filter(e => !e.excluded).map(e => [e.userId, e]))

    const people: PersonVariance[] = []

    for (const entry of after.values()) {
        const was = before.get(entry.userId)
        const previousMinor = was ? was.netMinor : null
        const currentMinor = entry.totals.netMinor
        const deltaMinor = currentMinor - (previousMinor ?? 0)
        people.push({
            userId: entry.userId,
            name: entry.name,
            previousMinor,
            currentMinor,
            deltaMinor,
            kind: previousMinor === null ? "NEW" : deltaMinor === 0 ? "SAME" : "CHANGED",
        })
    }

    for (const was of before.values()) {
        if (after.has(was.userId)) continue
        people.push({
            userId: was.userId,
            name: was.name,
            previousMinor: was.netMinor,
            currentMinor: null,
            deltaMinor: -was.netMinor,
            kind: "GONE",
        })
    }

    const previousTotalMinor = previous.reduce((sum, p) => sum + p.netMinor, 0)
    const currentTotalMinor = [...after.values()].reduce((sum, e) => sum + e.totals.netMinor, 0)

    return {
        previousTotalMinor,
        currentTotalMinor,
        deltaMinor: currentTotalMinor - previousTotalMinor,
        people: people.sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor)),
    }
}

/** How many payslips one issue action sends. See the note in nextIssueBatch. */
export const ISSUE_BATCH_SIZE = 25

/**
 * The next payslips to send, and how many are left.
 *
 * Email leaves through one Gmail account over nodemailer, with no queue and no
 * retry, and a bulk issue is that many sequential SMTP round-trips inside one
 * request. The cap matters less than resuming: each payslip is stamped as its
 * send succeeds, so a timeout costs a pause rather than sixty people receiving
 * their payslip twice.
 *
 * Excluded payslips are never sent. They are on the register to be seen, not to
 * be issued.
 */
export function nextIssueBatch<T extends { id: string; emailedAt?: Date | null; excluded?: boolean }>(
    payslips: T[],
    size: number = ISSUE_BATCH_SIZE,
): { batch: T[]; remaining: number; total: number } {
    const sendable = payslips.filter(p => !p.excluded)
    const unsent = sendable.filter(p => !p.emailedAt)
    return {
        batch: unsent.slice(0, size),
        remaining: Math.max(0, unsent.length - size),
        total: sendable.length,
    }
}

/**
 * How far issuing has got.
 *
 * Reported as a count rather than a flag because the honest answer to "have the
 * payslips gone out" is usually a number: batches resume, a reserved address is
 * never stamped, and a run can sit at 48 of 50 indefinitely. A boolean would
 * have to round that to yes or no, and both are wrong.
 */
export function issueProgress<T extends { emailedAt?: Date | null; excluded?: boolean }>(
    payslips: T[],
): { sent: number; sendable: number; unsent: number } {
    const sendable = payslips.filter(p => !p.excluded)
    const sent = sendable.filter(p => p.emailedAt).length
    return { sent, sendable: sendable.length, unsent: sendable.length - sent }
}
