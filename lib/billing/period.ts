/**
 * Subscription period arithmetic.
 *
 * Pure functions, no Prisma, no clock beyond what the caller passes in — the
 * whole of this feature's correctness is date maths, so it is kept where it can
 * be tested exhaustively rather than inlined into a service method.
 */

import { addMonths, addYears } from "@/lib/date-math"

// Re-exported so callers reading about subscription periods do not have to know
// where the calendar arithmetic lives. Both are shared with recurring
// obligations, which had the same overflow defect.
export { addMonths, addYears }

export type SubscriptionType = 'MONTHLY' | 'ANNUALLY' | 'LIFETIME'

export const SUBSCRIPTION_TYPES: SubscriptionType[] = ['MONTHLY', 'ANNUALLY', 'LIFETIME']

export function isSubscriptionType(value: string): value is SubscriptionType {
    return (SUBSCRIPTION_TYPES as string[]).includes(value)
}

/**
 * The end of a period that starts at `start`.
 *
 * Returns null for LIFETIME, and null is the point: a lifetime subscription has
 * no end date, it is not a subscription with an end date far in the future.
 * Every reader must treat null as "never expires" — see `isExpired`.
 *
 * This replaces `endDate.setDate(startDate.getDate() + 30)`, under which a
 * "month" was 30 days while a year was a calendar year, so twelve monthly
 * payments bought 360 days and the customer quietly lost five days a year.
 */
export function computePeriodEnd(start: Date, type: SubscriptionType): Date | null {
    switch (type) {
        case 'MONTHLY': return addMonths(start, 1)
        case 'ANNUALLY': return addYears(start, 1)
        case 'LIFETIME': return null
    }
}

/**
 * When a newly confirmed period begins.
 *
 * Paying early must not throw away the time already paid for, so a renewal
 * starts at the current period's end rather than today. Paying late — after
 * expiry — starts today, because back-dating would sell a period that is
 * already partly spent.
 *
 * `currentEnd` of null means the company already holds a lifetime
 * subscription; there is nothing to extend and the caller should not be
 * charging again, but the safe answer is still `now`.
 */
export function computePeriodStart(now: Date, currentEnd: Date | null | undefined): Date {
    if (!currentEnd) return now
    return currentEnd.getTime() > now.getTime() ? new Date(currentEnd.getTime()) : now
}

/**
 * Whether a period has ended.
 *
 * The reason this exists as a function rather than a comparison at each call
 * site: `endDate < new Date()` coerces a null endDate to the epoch, so every
 * lifetime subscription reads as expired since 1970. That is a one-character
 * mistake that silently locks out the customers who paid the most.
 */
export function isExpired(endDate: Date | null | undefined, now: Date = new Date()): boolean {
    if (!endDate) return false
    return endDate.getTime() <= now.getTime()
}

/**
 * Whole days from `now` until `endDate`, rounded up, so the last partial day
 * still reads as 1 rather than 0. Null (lifetime) has no countdown.
 */
export function daysUntil(endDate: Date | null | undefined, now: Date = new Date()): number | null {
    if (!endDate) return null
    return Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}
