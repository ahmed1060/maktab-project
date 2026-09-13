/**
 * Calendar arithmetic that clamps instead of overflowing.
 *
 * Lives here rather than under lib/billing because it is not about billing:
 * subscriptions and recurring obligations both advance a date by months, and
 * both were wrong in the same way for the same reason.
 */

/**
 * Adds calendar months, clamping to the last valid day of the target month.
 *
 * The native `setMonth` overflows rather than clamping: 31 January + 1 month
 * gives 3 March, because 31 February rolls forward into March. Wherever a date
 * advances by months, that overflow skips the short month entirely — a monthly
 * obligation due on the 31st never gets a February instance at all.
 *
 * Clamping is also what keeps the result stable: 31 January + 1 month is
 * 28 February, and 28 February + 1 month is 28 March, not 31 March. A caller
 * that wants the original day-of-month back must remember it separately;
 * nothing can recover it from the clamped date, because 28 February is
 * indistinguishable from a date that was always the 28th.
 */
export function addMonths(date: Date, months: number): Date {
    const day = date.getDate()
    const result = new Date(date.getTime())

    // Move to the 1st before shifting the month, so the shift itself can never
    // overflow, then restore the day against the target month's real length.
    result.setDate(1)
    result.setMonth(result.getMonth() + months)

    const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
    result.setDate(Math.min(day, lastDayOfTargetMonth))

    return result
}

/**
 * Adds calendar years, clamping 29 February to 28 February in a non-leap year.
 * Expressed in months so there is exactly one clamping rule in this file.
 */
export function addYears(date: Date, years: number): Date {
    return addMonths(date, years * 12)
}

/**
 * Adds whole days. Unlike months, a day is a fixed length, so `setDate` rolls
 * across month and year boundaries correctly and there is nothing to clamp.
 */
export function addDays(date: Date, days: number): Date {
    const result = new Date(date.getTime())
    result.setDate(result.getDate() + days)
    return result
}

/** Adds whole hours. Same reasoning as `addDays`. */
export function addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000)
}
