/**
 * Which calendar zones this system can actually serve, and why it is fewer than
 * all of them.
 *
 * The zone became a column in P8, so it became something a Super Admin can
 * type. The crons did not become zone-aware at the same time: salary
 * initialisation still fires once, for every company at the same instant, on a
 * UTC schedule. That is fine for a company ahead of UTC and wrong for one far
 * enough behind it, and "wrong" here means the job creates next month's salary
 * record while that customer is still living in this one.
 *
 * So the column is validated rather than merely stored. A company that cannot
 * be served correctly is refused at the moment somebody tries to onboard it,
 * with an error naming the reason — which is a far better place to find out
 * than a payslip filed against the wrong month.
 */

import { DEFAULT_TIME_ZONE, offsetMsIn } from "./time"

/**
 * The hour, in UTC, that salary initialisation fires on the 1st.
 *
 * The bound below is derived from this rather than written beside it. If the
 * schedule moves, the set of serviceable zones moves with it, and a test pins
 * this against what vercel.json actually says — because a constant that has
 * silently stopped matching the thing it describes is worse than no constant.
 */
export const SALARY_INIT_UTC_HOUR = 2

/**
 * A zone this far behind UTC still reads "the 1st" when the job fires.
 *
 * At SALARY_INIT_UTC_HOUR on the 1st, a zone at offset X reads that hour plus
 * X. For that to still be inside the new month, X must be at or above
 * -SALARY_INIT_UTC_HOUR. Cairo sits at +02:00 or +03:00, comfortably clear; so
 * does all of Africa, Europe, the Middle East and Asia. The Americas do not.
 */
export const MIN_OFFSET_MINUTES = -SALARY_INIT_UTC_HOUR * 60

export interface TimeZoneVerdict {
    ok: boolean
    /** Why not, in the words somebody onboarding a company would need. */
    reason?: string
    /** The zone's smallest offset across the year, in minutes. */
    minOffsetMinutes?: number
}

/** True when the runtime's timezone database recognises this name at all. */
export function isKnownTimeZone(zone: string): boolean {
    if (typeof zone !== "string" || zone.trim() === "") return false
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone })
        return true
    } catch {
        return false
    }
}

/**
 * The smallest UTC offset a zone takes across the year, in minutes.
 *
 * Sampled at both solstices rather than read once. A zone's offset moves with
 * daylight saving, and checking only today would admit a company in January
 * that becomes unserviceable in June — the kind of fault that appears six
 * months after the change that caused it.
 */
export function minOffsetMinutes(zone: string, year: number = new Date().getUTCFullYear()): number {
    const samples = [Date.UTC(year, 0, 15, 12), Date.UTC(year, 6, 15, 12)]
    return Math.min(...samples.map(t => offsetMsIn(new Date(t), zone) / 60000))
}

/** Whether a company may be set to this zone, and if not, what to tell whoever tried. */
export function checkTimeZone(zone: string): TimeZoneVerdict {
    if (!isKnownTimeZone(zone)) {
        return { ok: false, reason: `"${zone}" is not a time zone this system recognises.` }
    }

    const offset = minOffsetMinutes(zone)
    if (offset < MIN_OFFSET_MINUTES) {
        const hours = (offset / 60).toFixed(1).replace(/\.0$/, "")
        return {
            ok: false,
            minOffsetMinutes: offset,
            reason:
                `"${zone}" is UTC${offset < 0 ? "" : "+"}${hours}, which is further behind UTC than this system can serve. ` +
                `The scheduled jobs that create each month's salary records run once for every company, ` +
                `at ${String(SALARY_INIT_UTC_HOUR).padStart(2, "0")}:00 UTC on the 1st — so for a zone behind ` +
                `UTC${MIN_OFFSET_MINUTES / 60} it would still be the previous month there. ` +
                `Making the crons zone-aware is what this needs, not a wider validation.`,
        }
    }

    return { ok: true, minOffsetMinutes: offset }
}

export function isSupportedTimeZone(zone: string): boolean {
    return checkTimeZone(zone).ok
}

/** Throws with the reason. For a writer that has nowhere to put a soft verdict. */
export function assertSupportedTimeZone(zone: string): void {
    const verdict = checkTimeZone(zone)
    if (!verdict.ok) throw new Error(verdict.reason)
}

/**
 * The zone to use, given what is known.
 *
 * Two levels, then the constant: the company's own, the platform default on
 * SystemSettings for anybody without a company, and only then the built-in.
 * One resolver so the fallback is never re-improvised at a call site — and an
 * unserviceable value that somehow reached the column falls back rather than
 * throwing, because a bad setting should not take down every page that needs to
 * know what month it is.
 */
export function resolveTimeZone(
    companyZone?: string | null,
    platformZone?: string | null,
): string {
    for (const candidate of [companyZone, platformZone]) {
        if (candidate && isSupportedTimeZone(candidate)) return candidate
    }
    return DEFAULT_TIME_ZONE
}
