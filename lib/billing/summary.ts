import { resolveSubscriptionState, type SubscriptionState, type TrialPreset } from "./state"
import { calendarParts } from "@/lib/time"

/**
 * The subscription facts a session needs, flattened to what survives a JSON
 * round trip through the token.
 *
 * A Date does not survive that trip as a Date, so the date travels as an ISO
 * string — and `state` travels already computed rather than being recomputed in
 * the browser. The plan is explicit: the note above the page displays a
 * number the server computed, and no part of the lockout lives in the client.
 */
export type SubscriptionSummary = {
    state: SubscriptionState
    /** ISO, or null for lifetime and grandfathered. */
    date: string | null
    daysRemaining: number | null
    /**
     * Days from today to the day `date` falls on, on Egypt's calendar, as
     * subscriptions are counted: 0 on that day, which a trial and grace last
     * to the end of. For the note above the page (DESIGN.md §5.5). The hours
     * `daysRemaining` counts round up from the date's time of day, so a trial
     * said 0 days left all through its last day. Null without a date.
     */
    daysToLastDay: number | null
}

type CompanyForSummary = {
    createdAt: Date
    trialPreset: TrialPreset | string | null
    trialExtensionDays: number | null
    payments: { endDate: Date | null; graceExtensionHours: number | null }[]
} | null | undefined

/**
 * Null for a Super Admin, who has no company and no subscription — distinct
 * from a company whose subscription could not be determined.
 */
export function summarizeSubscription(company: CompanyForSummary, now: Date = new Date()): SubscriptionSummary | null {
    if (!company) return null

    const status = resolveSubscriptionState({
        createdAt: company.createdAt,
        trialPreset: (company.trialPreset as TrialPreset) ?? null,
        trialExtensionDays: company.trialExtensionDays ?? 0,
        latestPaidPeriod: company.payments?.[0] ?? null,
    }, now)

    return {
        state: status.state,
        date: status.date ? status.date.toISOString() : null,
        daysRemaining: status.daysRemaining,
        daysToLastDay: status.date ? egyptDay(status.date) - egyptDay(now) : null,
    }
}

/** A day's number on Egypt's calendar, for counting the days between two. */
function egyptDay(instant: Date): number {
    const { year, month, day } = calendarParts(instant)
    return Date.UTC(year, month - 1, day) / 86_400_000
}
