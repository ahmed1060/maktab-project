/**
 * When the money moves, as distinct from what is owed.
 *
 * A final settlement is produced the moment a contract ends. The payroll day
 * governs only when it is paid — and, more importantly, which way it points:
 * end a contract on the 25th of a month paid on the 28th and the company owes
 * twenty-five days; end it on the 25th of a month paid on the 20th and the
 * person owes back the five days they were paid for and did not work. Same
 * date, same salary, opposite direction.
 *
 * Pure, and separate from the tables, because that rule is worth testing
 * against worked examples rather than against a database.
 */

import { calendarParts, startOfDayIn, DEFAULT_TIME_ZONE } from "./time"
import { daysInMonth } from "./payroll"

/**
 * 1-28, and not 29-31.
 *
 * A payroll day that does not occur in February is a payroll day that silently
 * moves. "The 30th" meaning the 28th in one month out of twelve is exactly the
 * kind of rule nobody remembers when they are looking at a payslip and trying
 * to work out why a leaver was billed rather than paid.
 */
export const MAX_PAYROLL_DAY = 28

export function isValidPayrollDay(day: number): boolean {
    return Number.isInteger(day) && day >= 1 && day <= MAX_PAYROLL_DAY
}

export function assertValidPayrollDay(day: number): void {
    if (!isValidPayrollDay(day)) {
        throw new Error(
            `Payroll day must be between 1 and ${MAX_PAYROLL_DAY}. ` +
            `A day that does not occur in every month is a day that moves without anybody deciding it should.`
        )
    }
}

/** The instant payday begins, in a given month, in the company's calendar. */
export function paydayIn(
    year: number,
    month: number,
    payrollDay: number,
    timeZone: string = DEFAULT_TIME_ZONE,
): Date {
    assertValidPayrollDay(payrollDay)
    if (month < 1 || month > 12) throw new Error(`Not a month: ${month}`)
    // Midday, so the instant is safely on the intended calendar day in any zone,
    // then snapped to that day's start.
    return startOfDayIn(new Date(Date.UTC(year, month - 1, payrollDay, 12)), timeZone)
}

/**
 * Has this month's payday already been and gone, as at `at`?
 *
 * Inclusive of payday itself: on the 25th of a month paid on the 25th, the
 * money has gone out. Rounding this the other way would tell somebody leaving
 * on payday that they are owed a month they have already been paid.
 */
export function paydayHasPassed(
    at: Date,
    payrollDay: number,
    timeZone: string = DEFAULT_TIME_ZONE,
): boolean {
    const { year, month } = calendarParts(at, timeZone)
    const payday = paydayIn(year, month, payrollDay, timeZone)
    // Compare against the end of `at`'s own day, so any time on payday counts.
    const endOfThatDay = startOfDayIn(at, timeZone).getTime() + 24 * 60 * 60 * 1000 - 1
    return endOfThatDay >= payday.getTime()
}

/**
 * The first payday on or after an instant — the date a settlement produced now
 * would actually be paid on, and so its default due date.
 */
export function nextPaydayOnOrAfter(
    at: Date,
    payrollDay: number,
    timeZone: string = DEFAULT_TIME_ZONE,
): Date {
    const { year, month } = calendarParts(at, timeZone)
    const thisMonth = paydayIn(year, month, payrollDay, timeZone)
    if (thisMonth.getTime() >= startOfDayIn(at, timeZone).getTime()) return thisMonth

    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    return paydayIn(nextYear, nextMonth, payrollDay, timeZone)
}

/**
 * How many days of the final month have already been paid for, given the
 * payroll day.
 *
 * The company pays the whole month on payday, so somebody still employed then
 * has been paid for all of it — including the days after payday they have not
 * worked yet. That is the tail window, and it is exactly what a leaver inside
 * it owes back.
 *
 * Returns 0 when payday has not come round, because nothing has gone out.
 */
export function daysAlreadyPaid(
    lastWorkingDay: Date,
    payrollDay: number,
    timeZone: string = DEFAULT_TIME_ZONE,
): number {
    if (!paydayHasPassed(lastWorkingDay, payrollDay, timeZone)) return 0
    const { year, month } = calendarParts(lastWorkingDay, timeZone)
    return daysInMonth(year, month)
}
