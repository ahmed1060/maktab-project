import { workDays } from "./day-off-range"
import { lastDayOf } from "./payroll-period"
import type { TranslationKey } from "./translations"

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

/**
 * Which days may be asked for, in the page's language and digits
 * (LATER_CHANGES_PLAN.md §7.4): "from 1 November to 27 December", with the
 * years where the two differ. A day off says it with its words (4a),
 * permission hours with theirs (4b).
 */
export function daysText(t: (key: TranslationKey) => string, locale: string, days: DayOffDays, key: TranslationKey = "requests_day_off_range"): string {
    const years = days.from.slice(0, 4) !== days.to.slice(0, 4)
    const format = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long", ...(years ? { year: "numeric" } : {}), timeZone: "UTC" })
    const text = (iso: string) => format.format(new Date(`${iso}T00:00:00Z`))
    return t(key).replace("{from}", text(days.from)).replace("{to}", text(days.to))
}

/**
 * Whether permission hours' calendar offers a day, as the day's balance
 * sends what it offers (LATER_CHANGES_PLAN.md §7.20): any day, within its
 * days; around the day, from its first, with no last. Before the balance
 * has come, nothing is held back.
 */
export function offeredDay(date: string, balance: { days: DayOffDays | null; earliest?: string | null } | null | undefined): boolean {
    if (!balance) return true
    const from = balance.days?.from ?? balance.earliest ?? null
    const to = balance.days?.to ?? null
    return (!from || date >= from) && (!to || date <= to)
}
