/**
 * A calendar day, "2026-10-20", as a Date at that day's local midnight, to
 * format for the page. `new Date("2026-10-20")` reads it as midnight UTC
 * instead, which a browser west of UTC shows as the 19th.
 */
export function calendarDay(iso: string): Date {
    const [year, month, day] = iso.split("-").map(Number)
    return new Date(year, month - 1, day)
}
