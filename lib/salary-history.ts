import { calendarParts, startOfMonthIn, DEFAULT_TIME_ZONE } from "./time"
import { toMinor, daysInMonth, type RateChange } from "./payroll"

/**
 * Turning a salary history into the rates a month is split on.
 *
 * Pure, and separate from the service that reads the rows, because this is
 * where the interesting mistakes live: which change is in force on the 1st,
 * what a change dated mid-month does to the days before it, and what happens
 * when two changes share a date. A database is not needed to get any of those
 * wrong, so it should not be needed to test them either.
 */

/** A row as stored, narrowed to what the calculation needs. */
export interface SalaryChangeRow {
    monthlyAmount: number | string
    effectiveFrom: Date
    reason?: string | null
    /** Breaks ties when two changes share an effective date. */
    createdAt?: Date
}

/** The two answers to "does this take effect now, or next month?" */
export type EffectiveChoice = "THIS_MONTH" | "NEXT_MONTH"

/**
 * The prompt's answer, as a date.
 *
 * Month granularity, because that is the question being asked: "the current
 * month or the next one" is about which month's pay changes, not about which
 * day. Both answers land on a month boundary, so the month a change takes
 * effect in is paid entirely at the new rate.
 *
 * Storing the answer rather than acting on it is the point. A choice made in
 * September about October has to still be true when October's payroll runs, and
 * a boolean that meant "next" at the time it was clicked means nothing a month
 * later.
 */
export function effectiveFromChoice(
    now: Date,
    choice: EffectiveChoice,
    timeZone: string = DEFAULT_TIME_ZONE,
): Date {
    const thisMonth = startOfMonthIn(now, timeZone)
    if (choice === "THIS_MONTH") return thisMonth

    // One millisecond into the next month, then snapped to its start — rather
    // than month + 1, which has to special-case December and gets the DST
    // offset from the wrong side of the boundary.
    const { year, month } = calendarParts(now, timeZone)
    const daysLeft = daysInMonth(year, month)
    const intoNext = new Date(thisMonth.getTime() + (daysLeft + 1) * 24 * 60 * 60 * 1000)
    return startOfMonthIn(intoNext, timeZone)
}

/**
 * The rates in force across one calendar month, as splitMonth wants them.
 *
 * Every change before the month collapses into a single day-1 rate — the latest
 * one, which is the rate the month opens on. Changes inside the month keep their
 * own day. Changes after it are ignored: a payslip for March must not be moved
 * by a raise granted in April, and reading the whole history without this filter
 * is exactly how a closed month silently changes value.
 *
 * Throws if nothing was in force. That is not a rate of zero — zero is a real
 * salary somebody could be on — it is a person with no salary history at all,
 * and a payslip computed from a guess is worse than one that refuses to compute.
 */
export function ratesForMonth(
    changes: SalaryChangeRow[],
    year: number,
    month: number,
    timeZone: string = DEFAULT_TIME_ZONE,
): RateChange[] {
    const monthStart = startOfMonthIn(
        // Midday, so the instant is safely inside the month in any zone.
        new Date(Date.UTC(year, month - 1, 1, 12)),
        timeZone,
    )
    const nextMonthStart = effectiveFromChoice(monthStart, "NEXT_MONTH", timeZone)

    const ordered = [...changes].sort((a, b) => {
        const byDate = a.effectiveFrom.getTime() - b.effectiveFrom.getTime()
        if (byDate !== 0) return byDate
        // Same effective date: the row written later is the correction.
        return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
    })

    const before = ordered.filter(c => c.effectiveFrom.getTime() < monthStart.getTime())
    const during = ordered.filter(
        c => c.effectiveFrom.getTime() >= monthStart.getTime()
            && c.effectiveFrom.getTime() < nextMonthStart.getTime(),
    )

    const rates: RateChange[] = []

    const opening = before[before.length - 1]
    if (opening) {
        rates.push({
            fromDay: 1,
            monthlyMinor: toMinor(Number(opening.monthlyAmount)),
            reason: opening.reason ?? undefined,
        })
    }

    for (const change of during) {
        const { day } = calendarParts(change.effectiveFrom, timeZone)
        rates.push({
            fromDay: day,
            monthlyMinor: toMinor(Number(change.monthlyAmount)),
            reason: change.reason ?? undefined,
        })
    }

    if (rates.length === 0) {
        throw new Error(`No salary in effect for ${year}-${String(month).padStart(2, "0")}`)
    }

    // One rate per day, last wins.
    //
    // Two entries can land on the same day honestly: a change effective at the
    // very start of the month arrives as a "during" change on day 1, beside the
    // opening rate carried in from before. splitMonth would resolve that
    // correctly, but only because of its own tie-break — and output that relies
    // on a downstream rule to make sense is output that will be misread by the
    // next thing to consume it. Collapsing here means a day appears once, and a
    // segment can never be asked to span zero days.
    const byDay = new Map<number, RateChange>()
    for (const rate of rates) byDay.set(rate.fromDay, rate)
    return [...byDay.values()].sort((a, b) => a.fromDay - b.fromDay)
}

/**
 * The rate in force at a single instant — for a screen showing "current
 * salary", or for valuing something that happened on one day.
 */
export function rateAt(
    changes: SalaryChangeRow[],
    at: Date,
): SalaryChangeRow | null {
    const applicable = changes
        .filter(c => c.effectiveFrom.getTime() <= at.getTime())
        .sort((a, b) => {
            const byDate = a.effectiveFrom.getTime() - b.effectiveFrom.getTime()
            if (byDate !== 0) return byDate
            return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
        })
    return applicable[applicable.length - 1] ?? null
}
