/**
 * Whether a day-off request runs past the day it starts, so the list shows
 * both ends: "20 Oct 2026 – 21 Oct 2026" rather than the first day alone.
 *
 * Days are calendar days, kept as midnight UTC, as the request form sends
 * them. A two-day request ends exactly one day after it starts, so it's the
 * days that are compared, not whether more than a day lies between them.
 */
export function spansDays(date: string, endDate?: string | null): boolean {
    if (!endDate) return false
    return calendarDay(endDate) !== calendarDay(date)
}

function calendarDay(iso: string): string {
    return new Date(iso).toISOString().slice(0, 10)
}

/**
 * The work days a request covers: every day but Friday. Counted by calendar
 * day, as the days are kept, so a screen west of UTC doesn't count each one
 * as the day before.
 */
export function workDays(date: string, endDate?: string | null): number {
    const day = new Date(`${calendarDay(date)}T00:00:00.000Z`)
    const last = new Date(`${calendarDay(endDate || date)}T00:00:00.000Z`)
    let count = 0
    for (; day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
        if (day.getUTCDay() !== 5) count++
    }
    return count
}
