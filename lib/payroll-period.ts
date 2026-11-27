import { addDays, companyWeekOn, weekdayOf, type WorkWeekChange } from "./attendance/calendar"

/**
 * Payday and the attendance period (LATER_CHANGES_PLAN.md §7.10, PR 430).
 *
 * A month's payroll closes on its last day, or on a day the company sets:
 * its attendance counts from the day after the month before's close to its
 * own, and it may be approved from the day after. Payday comes after the
 * close, on a day or the month's last, in the payroll's own month or the
 * next, moved off a day off the way the company says, and never back into
 * the period.
 *
 * Pure, and in dates ('YYYY-MM-DD'), so each rule is tested on worked
 * examples; lib/services/payroll-period.service.ts reads what they need.
 */

/** Payday as set: a day 1 to 28 or the month's last, in its own month or the next, and where it moves off a day off. */
export type PaydaySetting = { day: number; lastDay: boolean; nextMonth: boolean; move: "BEFORE" | "AFTER" }

/** A payroll month's attendance days, both counted. */
export type Period = { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, "0")
export const monthKeyOf = (year: number, month: number) => `${year}-${pad(month)}`
export const nextMonth = (year: number, month: number) => (month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 })
export const previousMonth = (year: number, month: number) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 })
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** The month's last day. */
export function lastDayOf(year: number, month: number): string {
    return `${monthKeyOf(year, month)}-${pad(daysIn(year, month))}`
}

/** The day a month's payroll closes by the setting: the day set, or the month's last. */
export function closeDateOf(year: number, month: number, closeDay: number | null): string {
    return closeDay == null ? lastDayOf(year, month) : `${monthKeyOf(year, month)}-${pad(closeDay)}`
}

/** A month's attendance days: from the day after the month before's close to its own. */
export function periodBetween(previousClose: string, close: string): Period {
    return { from: addDays(previousClose, 1), to: close }
}

/** The payroll month a date belongs to: its own month's up to that month's close, the next month's after it. */
export function payrollMonthOf(date: string, closeOf: (year: number, month: number) => string): string {
    const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7))
    if (date <= closeOf(year, month)) return monthKeyOf(year, month)
    const next = nextMonth(year, month)
    return monthKeyOf(next.year, next.month)
}

/** Payday as set, before it moves off a day off. */
export function nominalPayday(year: number, month: number, setting: PaydaySetting): string {
    const paid = setting.nextMonth ? nextMonth(year, month) : { year, month }
    return setting.lastDay ? lastDayOf(paid.year, paid.month) : `${monthKeyOf(paid.year, paid.month)}-${pad(setting.day)}`
}

/** A day off for the company: a weekend day by the policy in force that day, Friday and Saturday without one, or a holiday it observes. */
export function dayOffOn(date: string, calendar: { weeks: readonly WorkWeekChange[]; holidays: ReadonlySet<string> }): boolean {
    return calendar.holidays.has(date) || !companyWeekOn(calendar.weeks, date).includes(weekdayOf(date))
}

/** Enough days to step past any run of days off; a calendar of nothing but days off leaves payday where it was set. */
const MOST_STEPS = 60

/**
 * Payday moved off a day off: back to the working day before, or forward to
 * the one after. Moving back never reaches the period's last day or before
 * it; there, it moves forward instead.
 */
export function movePayday(nominal: string, move: "BEFORE" | "AFTER", isDayOff: (date: string) => boolean, periodEnd: string): string {
    if (!isDayOff(nominal)) return nominal
    const step = (direction: 1 | -1): string | null => {
        let date = nominal
        for (let i = 0; i < MOST_STEPS; i++) {
            date = addDays(date, direction)
            if (direction === -1 && date <= periodEnd) return null
            if (!isDayOff(date)) return date
        }
        return null
    }
    return (move === "BEFORE" ? step(-1) : null) ?? step(1) ?? nominal
}

/**
 * Whether payday always comes after the close: in the month after, always;
 * in the own month, a day after the close day, or the last day with a close
 * up to the 27th, February's 28th being the shortest last day.
 */
export function paydayAfterClose(setting: PaydaySetting, closeDay: number | null): boolean {
    if (setting.nextMonth) return true
    if (closeDay == null) return false
    return setting.lastDay ? closeDay < 28 : setting.day > closeDay
}

/** Why a payday is refused, with the close it has to come after; null where it's after it. */
export function paydayRefusal(setting: PaydaySetting, closeDay: number | null): { code: "PAYDAY_BEFORE_CLOSE"; closeDay: number | null } | null {
    return paydayAfterClose(setting, closeDay) ? null : { code: "PAYDAY_BEFORE_CLOSE", closeDay }
}

/** Whether a month is already paid by a leaver's last working day: from payday on, payday itself included. */
export function paidAlready(lastWorkingDay: string, payday: string): boolean {
    return lastWorkingDay >= payday
}
