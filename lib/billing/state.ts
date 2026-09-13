/**
 * Subscription state, computed — never stored.
 *
 * "Is this company locked" is a conclusion drawn from dates, so it must not
 * become a column. Store facts and decisions; compute conclusions. A stored
 * flag has to be kept in step by something, and the thing that keeps it in step
 * is exactly what breaks.
 *
 * Pure: no Prisma, no clock except what the caller passes. The caller assembles
 * the facts; this decides what they mean.
 */

import { addDays, addHours, addMonths } from "@/lib/date-math"
import { endOfDayInEgypt } from "@/lib/time"

export type SubscriptionState = 'TRIAL' | 'ACTIVE' | 'GRACE' | 'LOCKED' | 'LIFETIME'

export type TrialPreset = 'TWO_DAYS' | 'SEVEN_DAYS' | 'FOURTEEN_DAYS' | 'ONE_MONTH' | 'THREE_MONTHS'

/** The standard grace window. Extensions are added on top, per payment. */
export const DEFAULT_GRACE_HOURS = 48

/** The window that counts as "ending soon" — the same 14 the reminder ladder starts at. */
export const ENDING_SOON_DAYS = 14

export const TRIAL_PRESETS: TrialPreset[] = ['TWO_DAYS', 'SEVEN_DAYS', 'FOURTEEN_DAYS', 'ONE_MONTH', 'THREE_MONTHS']

/** Preselected when nobody is thinking about it: the industry norm, and the middle of the range. */
export const DEFAULT_TRIAL_PRESET: TrialPreset = 'FOURTEEN_DAYS'

export function isTrialPreset(value: string): value is TrialPreset {
    return (TRIAL_PRESETS as string[]).includes(value)
}

/**
 * The base length of a preset, applied to a start date.
 *
 * Months go through the clamping helper rather than a day count, because the
 * options genuinely mix two units: "1 month" from 31 January is 28 February,
 * not 2 March.
 */
export function applyTrialPreset(start: Date, preset: TrialPreset): Date {
    switch (preset) {
        case 'TWO_DAYS': return addDays(start, 2)
        case 'SEVEN_DAYS': return addDays(start, 7)
        case 'FOURTEEN_DAYS': return addDays(start, 14)
        case 'ONE_MONTH': return addMonths(start, 1)
        case 'THREE_MONTHS': return addMonths(start, 3)
    }
}

/**
 * When a company's trial ends: the preset applied to its creation date, plus
 * any extensions. Computed on demand so it cannot drift from the facts it is
 * derived from — and so the creation form's live preview and the server can
 * never disagree, because they call this.
 *
 * Null preset means the company predates trials. There is no trial to end.
 */
export function computeTrialEnd(
    createdAt: Date,
    preset: TrialPreset | null | undefined,
    extensionDays: number = 0
): Date | null {
    if (!preset) return null
    return addDays(applyTrialPreset(createdAt, preset), extensionDays)
}

/**
 * When grace runs out for a period that has already ended.
 * Null endDate is a lifetime subscription: it never ends, so grace never starts.
 */
export function computeGraceEnd(endDate: Date | null | undefined, extensionHours: number = 0): Date | null {
    if (!endDate) return null
    return addHours(endDate, DEFAULT_GRACE_HOURS + extensionHours)
}

/** The facts a state decision needs. Assembled by the caller from the database. */
export type SubscriptionFacts = {
    createdAt: Date
    trialPreset?: TrialPreset | null
    trialExtensionDays?: number | null
    /**
     * The company's furthest-reaching confirmed payment, or null if it has never
     * paid. A row present with endDate null is a lifetime subscription.
     */
    latestPaidPeriod?: { endDate: Date | null; graceExtensionHours?: number | null } | null
    /** Whether any payment record is still unpaid — used by `needsAttention` only. */
    hasUnpaidPayment?: boolean
}

export type SubscriptionStatus = {
    state: SubscriptionState
    /**
     * The one date worth showing beside the badge, and which date it is depends
     * on the state. Null only for LIFETIME and for a grandfathered company,
     * because neither has one — not because it is unknown.
     */
    date: Date | null
    /** Days until `date`, or null when there is no date. Negative once it has passed. */
    daysRemaining: number | null
}

/**
 * The single place that decides what a company's dates mean.
 *
 * Order matters. A confirmed payment always wins over a trial: once somebody has
 * paid, the trial is history whether or not it had run out.
 */
export function resolveSubscriptionState(facts: SubscriptionFacts, now: Date = new Date()): SubscriptionStatus {
    const period = facts.latestPaidPeriod

    if (period) {
        // endDate null means never expires — never "expired long ago". Comparing
        // null as a date coerces it to the epoch and reports 1970, which would
        // lock out precisely the customers who paid the most.
        if (period.endDate === null || period.endDate === undefined) {
            return { state: 'LIFETIME', date: null, daysRemaining: null }
        }

        // The customer gets the whole of their last day. A raw comparison would
        // expire a subscription at whatever time of day the payment happened to
        // be confirmed — mid-morning, for the live one ending 8 October.
        const effectiveEnd = endOfDayInEgypt(period.endDate)

        if (effectiveEnd.getTime() > now.getTime()) {
            // The stored date is what is shown; the extension to end-of-day is
            // an enforcement detail, not something to display back.
            return withDays('ACTIVE', period.endDate, now)
        }

        const graceEnd = computeGraceEnd(effectiveEnd, period.graceExtensionHours ?? 0)!
        return graceEnd.getTime() > now.getTime()
            ? withDays('GRACE', graceEnd, now)
            // LOCKED shows when it locked, which is when grace ran out.
            : withDays('LOCKED', graceEnd, now)
    }

    const trialEnd = computeTrialEnd(facts.createdAt, facts.trialPreset, facts.trialExtensionDays ?? 0)

    // No payment and no trial: a company from before this feature existed.
    // Grandfathered, and deliberately never LOCKED — locking a live customer
    // because a column is null would be the worst thing this code could do.
    if (!trialEnd) {
        return { state: 'ACTIVE', date: null, daysRemaining: null }
    }

    return endOfDayInEgypt(trialEnd).getTime() > now.getTime()
        ? withDays('TRIAL', trialEnd, now)
        // A trial that ran out with no payment locks immediately. There is no
        // grace on a trial: grace is a courtesy to a paying customer.
        : withDays('LOCKED', trialEnd, now)
}

/**
 * Whether this state stops people working, and who it stops.
 *
 * LOCKED is the only state that blocks anybody. TRIAL and GRACE both keep
 * everything working — grace exists precisely so that an expiry is not a cliff,
 * and a trial that restricted things would not be showing the product.
 *
 * The company's own Admin is never blocked, in any state. They are the person
 * who has to be able to see what is wrong and act on it; locking them out would
 * leave the account with nobody able to renew it.
 */
export function isBlockedBySubscription(state: SubscriptionState, role: string | null | undefined): boolean {
    if (state !== 'LOCKED') return false
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') return false
    return true
}

/** Whether a state warrants telling the company about it, and how loudly. */
export function subscriptionNotice(state: SubscriptionState): 'none' | 'info' | 'warning' | 'blocked' {
    switch (state) {
        case 'TRIAL': return 'info'      // neutral countdown
        case 'GRACE': return 'warning'   // red, non-dismissible
        case 'LOCKED': return 'blocked'
        default: return 'none'
    }
}

function withDays(state: SubscriptionState, date: Date, now: Date): SubscriptionStatus {
    return {
        state,
        date,
        daysRemaining: Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    }
}

/**
 * Whether a company belongs on the "needs attention" list.
 *
 * Written before any of its callers, deliberately. Three surfaces ask this
 * question — the companies-list filter, the Super Admin dashboard count, and
 * the reminder job's notion of "ending soon" — and if the first of them ships
 * with the rule inlined, the shared version never arrives. That is not
 * hypothetical: the dashboard's existing count and the reminder threshold are
 * already two independent 14s that agree today and have nothing keeping them in
 * step tomorrow.
 */
export function needsAttention(facts: SubscriptionFacts, now: Date = new Date()): boolean {
    if (facts.hasUnpaidPayment) return true

    const { state, daysRemaining } = resolveSubscriptionState(facts, now)

    if (state === 'LOCKED' || state === 'GRACE') return true
    if (state === 'LIFETIME') return false

    // ACTIVE and TRIAL both qualify by how little time is left. A grandfathered
    // company has no date and never qualifies on time alone.
    return daysRemaining !== null && daysRemaining <= ENDING_SOON_DAYS
}
