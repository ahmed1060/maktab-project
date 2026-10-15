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
