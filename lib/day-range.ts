import { offsetMsIn } from "@/lib/time"

type Day = { year: number; month: number; day: number }

/** "2026-10-20" as a calendar day, or null for anything else. */
export function parseDay(value: string | null | undefined): Day | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "")
    if (!match) return null
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const check = new Date(Date.UTC(year, month - 1, day))
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
    return { year, month, day }
}

/** The first instant of a calendar day in a zone, as a UTC instant. */
function startOf({ year, month, day }: Day, timeZone: string): number {
    const guess = Date.UTC(year, month - 1, day)
    // The offset at the guess, then again at the answer, for a day the
    // clocks change on.
    const first = guess - offsetMsIn(new Date(guess), timeZone)
    return guess - offsetMsIn(new Date(first), timeZone)
}

/**
 * A list's date filter, from one calendar day to another, as instants where
 * the company is: from the first moment of the first day to the last moment
 * of the last. Each end is left open when it isn't a day; null when neither
 * is.
 *
 * The filters read the days as midnight UTC and ended them on the server's
 * own clock, also UTC, so in Cairo a filter "to 20 October" took in the
 * first hours of the 21st and "from 20 October" left out the first hours of
 * the 20th.
 */
export function dayRange(from: string | null | undefined, to: string | null | undefined, timeZone: string): { gte?: Date; lte?: Date } | null {
    const first = parseDay(from)
    const last = parseDay(to)
    if (!first && !last) return null
    const range: { gte?: Date; lte?: Date } = {}
    if (first) range.gte = new Date(startOf(first, timeZone))
    if (last) {
        const next = new Date(Date.UTC(last.year, last.month - 1, last.day + 1))
        range.lte = new Date(startOf({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, timeZone) - 1)
    }
    return range
}
