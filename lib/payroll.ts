/**
 * The payroll arithmetic, and nothing else.
 *
 * Pure by design: no Prisma, no clock, no I/O. Everything it needs arrives as
 * an argument, which is what makes the rules below testable against the
 * worked examples rather than against a database full of test data.
 *
 * Two decisions run through all of it.
 *
 * Money is integer minor units — piastres, not pounds. Float arithmetic on
 * money drifts (0.1 + 0.2 !== 0.3), and the schema already took this position:
 * every money column is Decimal(12,2) precisely so repeated arithmetic cannot
 * wander. Carrying that into the calculation means the rounding happens once,
 * where it is written down, instead of accumulating invisibly.
 *
 * And days from a month always carry that month's rate. That single rule
 * appeared three times in three disguises while this was being designed — a
 * mid-month salary change, a mid-month start, a settlement spanning two months
 * — and each time the tempting shortcut was one day rate for the whole
 * calculation. There isn't one: a day in February is worth more than a day in
 * January, because both are a thirtieth or a twenty-eighth of the same salary.
 */

/** An amount in minor units. Always an integer; never a float. */
export type Minor = number

/** Decimal(12,2) in the schema, so two minor digits. */
const MINOR_PER_MAJOR = 100

/**
 * Half-up on the magnitude, so a negative rounds away from zero exactly as its
 * positive twin does. Math.round(-0.5) is -0, which would make a deduction and
 * an earning of the same size round to different magnitudes — a difference
 * nobody could explain on a payslip.
 */
function roundHalfUp(value: number): Minor {
    return Math.sign(value) * Math.round(Math.abs(value))
}

/** Convert a major-unit amount — a Decimal column, a form field — to minor. */
export function toMinor(major: number | string): Minor {
    const n = typeof major === "string" ? Number(major) : major
    if (!Number.isFinite(n)) throw new Error(`Not an amount: ${major}`)
    return roundHalfUp(n * MINOR_PER_MAJOR)
}

/** Back to major units, for display and for writing to a Decimal column. */
export function toMajor(minor: Minor): number {
    return minor / MINOR_PER_MAJOR
}

/** Fixed two-decimal string, for a payslip line. */
export function formatMinor(minor: Minor): string {
    return (minor / MINOR_PER_MAJOR).toFixed(2)
}

/**
 * Days in a calendar month. `month` is 1-12, matching calendarMonth() rather
 * than Date's zero-based month.
 */
export function daysInMonth(year: number, month: number): number {
    if (month < 1 || month > 12) throw new Error(`Not a month: ${month}`)
    // Day 0 of the next month is the last day of this one.
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * What `days` days of work are worth, in the month they were worked.
 *
 * The rate is the salary divided by *that month's* length, so the same number
 * of days is worth more in February than in January. Every place that values
 * part of a month goes through here — a mid-month joiner, a leaver, a salary
 * change, a suspension, a final settlement — so there is one definition of a
 * day's pay rather than one per feature.
 *
 * The division is deliberately not rounded to a day rate first. Rounding the
 * rate and then multiplying compounds the error by the number of days:
 * 10,000.00 over 30 days is 333.333…, and eleven days of a rounded 333.33 is
 * 3,666.63 against a true 3,666.67. One rounding, at the end, on the answer
 * somebody is actually paid.
 */
export function valueDaysIn(
    year: number,
    month: number,
    days: number,
    monthlyMinor: Minor,
): Minor {
    const length = daysInMonth(year, month)
    if (days > length) {
        // Only a *window* of the month is bounded by its length. See
        // valueDayQuantity for the other kind of day, and why conflating them
        // was a real fault rather than a theoretical one.
        throw new Error(`${days} days in a ${length}-day month (${year}-${month})`)
    }
    return valueDayQuantity(year, month, days, monthlyMinor)
}

/**
 * What some number of days' pay is worth, where the number is a quantity rather
 * than a stretch of the month.
 *
 * The same arithmetic as valueDaysIn and deliberately not the same guard. A
 * segment cannot span more days than its month has — that is a bug in the
 * caller. An *adjustment* can: forty days' pay deducted to repay an advance is
 * an ordinary thing to record against a thirty-day month, and the excess
 * becomes debt rather than a negative payslip.
 *
 * These were one function until a register tried to value such a deduction and
 * threw, which would have taken down the whole company's payroll rather than
 * produced one large line. The bound that belongs on a window does not belong
 * on a quantity, and SalaryService already caps what can be written at all.
 */
export function valueDayQuantity(
    year: number,
    month: number,
    days: number,
    monthlyMinor: Minor,
): Minor {
    if (days < 0) throw new Error(`Negative days: ${days}`)
    return roundHalfUp((monthlyMinor * days) / daysInMonth(year, month))
}

/**
 * A stretch of days within one month at one salary.
 *
 * `fromDay` and `toDay` are both inclusive and 1-based, because that is how
 * everyone states them: "the 1st to the 15th" is fifteen days, not fourteen.
 */
export interface Segment {
    year: number
    /** 1-12. */
    month: number
    fromDay: number
    toDay: number
    monthlyMinor: Minor
    /** Carried through for the payslip line; the maths ignores it. */
    reason?: string
}

export function segmentDays(segment: Segment): number {
    return segment.toDay - segment.fromDay + 1
}

export function valueSegment(segment: Segment): Minor {
    const { year, month, fromDay, toDay, monthlyMinor } = segment
    const length = daysInMonth(year, month)
    if (fromDay < 1 || toDay > length || fromDay > toDay) {
        throw new Error(`Bad segment ${fromDay}-${toDay} in a ${length}-day month (${year}-${month})`)
    }
    return valueDaysIn(year, month, segmentDays(segment), monthlyMinor)
}

/** A salary that takes effect on a given day of the month. */
export interface RateChange {
    /** 1-based day of the month this rate starts applying. */
    fromDay: number
    monthlyMinor: Minor
    reason?: string
}

/**
 * Split a month into segments at each salary change.
 *
 * The output is contiguous and covers the worked window exactly once, which is
 * the property that matters: overlapping segments pay twice, and a gap pays
 * nothing for days somebody worked. Both are silent failures — the total simply
 * comes out wrong, with no line to point at.
 *
 * `changes` need not be sorted and may repeat a day; the last change given for
 * a day wins, which is how a correction entered after the fact should behave.
 */
export function splitMonth(
    year: number,
    month: number,
    changes: RateChange[],
    window?: { fromDay?: number; toDay?: number },
): Segment[] {
    const length = daysInMonth(year, month)
    const from = window?.fromDay ?? 1
    const to = window?.toDay ?? length

    if (from < 1 || to > length || from > to) {
        throw new Error(`Bad window ${from}-${to} in a ${length}-day month (${year}-${month})`)
    }
    if (changes.length === 0) throw new Error("No salary in effect for the window")

    const sorted = [...changes].sort((a, b) => a.fromDay - b.fromDay)

    // The rate in force on the first day of the window: the latest change on or
    // before it. Without this a mid-month joiner whose salary was set in a
    // previous month would have no rate at all.
    let current = sorted.filter(c => c.fromDay <= from).pop()
    if (!current) throw new Error(`No salary in effect on day ${from} of ${year}-${month}`)

    const segments: Segment[] = []
    let start = from

    for (const change of sorted) {
        if (change.fromDay <= from || change.fromDay > to) continue
        segments.push({ year, month, fromDay: start, toDay: change.fromDay - 1, monthlyMinor: current.monthlyMinor, reason: current.reason })
        start = change.fromDay
        current = change
    }

    segments.push({ year, month, fromDay: start, toDay: to, monthlyMinor: current.monthlyMinor, reason: current.reason })
    return segments
}

export type LineKind = "EARNING" | "DEDUCTION"

export interface PayslipLine {
    kind: LineKind
    label: string
    /** Always positive. The kind carries the sign. */
    amountMinor: Minor
}

export interface PayslipTotals {
    earningsMinor: Minor
    deductionsMinor: Minor
    /** Never negative. See below. */
    netMinor: Minor
    /**
     * What the deductions could not take because the net stopped at zero.
     * Nonzero means the person owes this much, and it becomes a debt with its
     * own due date rather than a negative payslip.
     */
    carriedMinor: Minor
}

/**
 * Add up a payslip.
 *
 * Each line is already a rounded minor amount, and the totals are sums of those
 * — never a re-derivation from the underlying rates. That is what makes the
 * printed lines add up to the printed total. Rounding the total separately
 * produces a document where the column does not sum to the figure beneath it,
 * and no amount of explanation makes that read as anything but an error.
 *
 * The net floors at zero. A payslip is a statement of what is being paid, and
 * negative pay is not a thing that happens — the employer does not take money
 * out of a bank account. What exceeds the earnings is carried out as a debt,
 * which is a different object with a status and a due date, and is the one
 * shape that stays true whether it is settled next month or never.
 */
export function totalPayslip(lines: PayslipLine[]): PayslipTotals {
    for (const line of lines) {
        if (!Number.isInteger(line.amountMinor)) {
            throw new Error(`Line "${line.label}" is not in whole minor units: ${line.amountMinor}`)
        }
        if (line.amountMinor < 0) {
            // A negative earning is a deduction wearing the wrong label, and it
            // would break the floor below: the sign must live in the kind so
            // that "earnings" on the document means what it says.
            throw new Error(`Line "${line.label}" is negative; use the other kind instead`)
        }
    }

    const earningsMinor = lines
        .filter(l => l.kind === "EARNING")
        .reduce((sum, l) => sum + l.amountMinor, 0)

    const deductionsMinor = lines
        .filter(l => l.kind === "DEDUCTION")
        .reduce((sum, l) => sum + l.amountMinor, 0)

    const rawNet = earningsMinor - deductionsMinor

    return {
        earningsMinor,
        deductionsMinor,
        netMinor: Math.max(0, rawNet),
        carriedMinor: rawNet < 0 ? -rawNet : 0,
    }
}
