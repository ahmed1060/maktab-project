import { workDays } from "./day-off-range"
import { lastDayOf } from "./payroll-period"

/**
 * The days a day off may be asked for (LATER_CHANGES_PLAN.md §7.4, 4a), as
 * calendar dates, "YYYY-MM-DD".
 */
export type DayOffDays = { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * From the first day not in an approved payroll's period, and never before
 * the 1st of last month, to today plus the policy's months ahead: the same
 * date that many months on, or that month's last day where it has fewer
 * (decided on 26 November). `today` is the company's; `firstOpen` is the day
 * after the latest approved or paid payroll's period, or null with none.
 */
export function dayOffWindow(today: string, monthsAhead: number, firstOpen: string | null): DayOffDays {
    const year = Number(today.slice(0, 4))
    const month = Number(today.slice(5, 7))
    const day = Number(today.slice(8, 10))
    const firstOfLast = month === 1 ? `${year - 1}-12-01` : `${year}-${pad(month - 1)}-01`
    const from = firstOpen && firstOpen > firstOfLast ? firstOpen : firstOfLast
    const on = year * 12 + (month - 1) + monthsAhead
    const toYear = Math.floor(on / 12)
    const toMonth = (on % 12) + 1
    const last = Number(lastDayOf(toYear, toMonth).slice(8, 10))
    return { from, to: `${toYear}-${pad(toMonth)}-${pad(Math.min(day, last))}` }
}

/** Whether the days picked are more than the balance, counted as approving counts them (`workDays`). */
export function overBalance(from: string, to: string, balance: number): boolean {
    if (!from) return false
    return workDays(from, to || from) > balance
}
