/**
 * Which calendar zones this system can serve — which, since G7, is all of them.
 *
 * This file used to refuse anything more than two hours behind UTC, and the
 * reason was real: salary initialisation fired once, monthly, at 02:00 UTC on
 * the 1st, and asked one global question about which month it was. At that
 * instant New York is still in the previous month, so the job would create next
 * month's record for a customer living in this one — and then not run again
 * until the month after. A validation error at onboarding was a far better
 * place to find that out than a payslip filed against the wrong month.
 *
 * The right fix was always to make the job zone-aware rather than to narrow the
 * world to fit it, and that is now done: the month is asked per company, in
 * that company's own calendar, and the schedule is daily. Daily is the
 * load-bearing half — a monthly cron pinned to the 1st in UTC has exactly one
 * chance to catch a calendar it does not share, and misses.
 *
 * So the offset bound is gone. What remains is the check that was always worth
 * having: that the string names a zone the runtime has actually heard of.
 */

import { DEFAULT_TIME_ZONE, offsetMsIn } from "./time"

export interface TimeZoneVerdict {
    ok: boolean
    /** Why not, in the words somebody onboarding a company would need. */
    reason?: string
    /**
     * The zone's smallest offset across the year, in minutes. Reported rather
     * than judged: nothing refuses on it now, and it is still the honest answer
     * to "how far from UTC is this company".
     */
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

    // No offset bound any more. It existed only to describe a limitation in the
    // salary-init schedule, and removing a limitation should remove the
    // apology for it rather than leave the apology standing on its own.
    return { ok: true, minOffsetMinutes: minOffsetMinutes(zone) }
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
