/**
 * How long ago a notification came (DESIGN.md §5.1): "Just now", "10 minutes
 * ago", "3 hours ago", "Yesterday", "4 days ago", and from a week on its
 * date, "28 Oct 2026". In the page's language, with Intl's own words for it,
 * as "a count and ago" put together by hand reads wrongly in Arabic.
 */

const intlOf = (locale: "en" | "ar") => (locale === "ar" ? "ar-EG" : "en-GB")

/** Midnight of the day an instant falls on, here, as a count of days. */
const dayOf = (ms: number) => {
    const d = new Date(ms)
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000
}

export function noticeAge(iso: string, now: number, locale: "en" | "ar", justNow: string): string {
    const then = Date.parse(iso)
    const intl = intlOf(locale)
    const minutes = Math.floor((now - then) / 60_000)
    // One the clock puts a little ahead is just now too.
    if (minutes < 1) return justNow
    const relative = new Intl.RelativeTimeFormat(intl, { numeric: "auto" })
    if (minutes < 60) return relative.format(-minutes, "minute")
    const hours = Math.floor(minutes / 60)
    // By the calendar from here on: yesterday is the day before today, not 24 to 48 hours.
    const days = dayOf(now) - dayOf(then)
    if (hours < 24 || days < 1) return relative.format(-hours, "hour")
    if (days < 7) {
        // "yesterday" begins the line, so it takes a capital where the language has them.
        const said = relative.format(-days, "day")
        return said.charAt(0).toLocaleUpperCase(intl) + said.slice(1)
    }
    return new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric" }).format(then)
}

/** The exact date and time, for the hover. */
export function noticeExactTime(iso: string, locale: "en" | "ar"): string {
    return new Intl.DateTimeFormat(intlOf(locale), { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(iso))
}
