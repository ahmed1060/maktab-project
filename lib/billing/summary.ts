import { resolveSubscriptionState, type SubscriptionState, type TrialPreset } from "./state"

/**
 * The subscription facts a session needs, flattened to what survives a JSON
 * round trip through the token.
 *
 * A Date does not survive that trip as a Date, so the date travels as an ISO
 * string — and `state` travels already computed rather than being recomputed in
 * the browser. The plan is explicit: the banner displays a number the server
 * computed, and no part of the lockout lives in the client.
 */
export type SubscriptionSummary = {
    state: SubscriptionState
    /** ISO, or null for lifetime and grandfathered. */
    date: string | null
    daysRemaining: number | null
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
    }
}
