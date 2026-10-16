/**
 * A record's expiry (CLIENTS_PLAN.md §0.2, DESIGN.md §5.5).
 *
 * An expiry is a calendar day, not a moment: a licence that expires on the
 * 20th is good all of the 20th. It is stored as that day's UTC midnight, and
 * compared as "YYYY-MM-DD", against today as the person writes it.
 *
 * One answer for the badge beside the date, the "Expiring soon" filter and
 * the daily reminder, so the filter finds exactly the records with the badge.
 */

/** From how many days before its expiry a record shows "Expires soon". */
export const EXPIRES_SOON_DAYS = 30

export type ExpiryState = "expired" | "soon"

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** "YYYY-MM-DD" to the instant it's stored as, or null when it isn't a real day. */
export function parseExpiryDay(value: string): Date | null {
    const m = DAY.exec(value)
    if (!m) return null
    const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    // 2026-02-30 rolls over into March; that isn't the day anybody chose.
    return at.toISOString().slice(0, 10) === value ? at : null
}

/** The calendar day a stored expiry stands for. */
export function expiryDay(expiry: Date | string): string {
    return new Date(expiry).toISOString().slice(0, 10)
}

/** A day so many days after another, both "YYYY-MM-DD". */
export function addDays(day: string, days: number): string {
    const at = parseExpiryDay(day)
    if (!at) throw new Error("INVALID_DATE")
    at.setUTCDate(at.getUTCDate() + days)
    return at.toISOString().slice(0, 10)
}

/** How many days from one day to a later one, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number {
    const a = parseExpiryDay(from), b = parseExpiryDay(to)
    if (!a || !b) throw new Error("INVALID_DATE")
    return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** Whether a record has expired, expires soon, or neither, on `today`. */
export function expiryState(expiry: Date | string | null | undefined, today: string): ExpiryState | null {
    if (!expiry) return null
    const day = expiryDay(expiry)
    if (day < today) return "expired"
    if (day <= addDays(today, EXPIRES_SOON_DAYS)) return "soon"
    return null
}

/** The stored instants a filter covers, for a query: the same days as the badge. */
export function expiryRange(state: ExpiryState, today: string): { gte?: Date; lt: Date } {
    const start = parseExpiryDay(today)
    if (!start) throw new Error("INVALID_DATE")
    if (state === "expired") return { lt: start }
    return { gte: start, lt: parseExpiryDay(addDays(today, EXPIRES_SOON_DAYS + 1))! }
}
