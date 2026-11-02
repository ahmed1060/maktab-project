'use client'

import { Fragment } from 'react'
import { StatusBadge } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import type { SubscriptionState } from '@/lib/billing/state'
import { countOf } from '@/lib/plural'
import { SUBSCRIPTION_TONE, isGrandfathered } from '@/lib/subscription-display'

/**
 * A company's subscription: its state as a status badge, in its meaning's
 * colour, and the one date that goes with it. Which date it is depends on the
 * state (trial end, subscription end, when grace runs out, when it locked);
 * the server has already decided that, and this only says it.
 *
 * On the building blocks (the Super Admin's pages part 3a): the badge is the
 * building blocks', and the date is a line of its own, so a table cell and a
 * phone card each put it where their details go.
 */
type Subscription = { state: SubscriptionState; date: string | null; daysRemaining: number | null }

export function SubscriptionBadge({ subscription }: { subscription: Subscription }) {
    const { t } = useLanguage()
    const look = SUBSCRIPTION_TONE[subscription.state]
    if (!look) return null
    // No subscription at all is not a premium one: it says so, without the healthy colour.
    if (isGrandfathered(subscription.state, subscription.date)) return <StatusBadge tone="neutral">{t('state_grandfathered')}</StatusBadge>
    return <StatusBadge tone={look.tone}>{t(look.labelKey)}</StatusBadge>
}

/** Whole days from today to that date, as the calendar counts them here: negative once it's past. */
export function calendarDaysTo(date: Date, now: Date = new Date()): number {
    const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    return Math.round((day(date) - day(now)) / 86400000)
}

/**
 * The date, and how far off it is: "16 Nov 2026, Ends in 14 days". A lifetime
 * subscription never ends and says so; a grandfathered company has no date,
 * and nothing is said rather than a dash.
 *
 * The days are counted to the date shown, on the calendar. The server's own
 * count rounds hours up, so two companies ending on the same day said 4 and
 * 5 days (found in the browser on part 3a).
 */
export function SubscriptionDates({ subscription }: { subscription: Subscription }) {
    const { t, locale } = useLanguage()
    const { state, date } = subscription
    if (!date) return state === 'LIFETIME' ? <span>{t('never_expires')}</span> : null
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const day = new Date(date).toLocaleDateString(intl, { day: 'numeric', month: 'short', year: 'numeric' })
    const days = (n: number) => countOf(t, locale, n, 'days')
    const left = calendarDaysTo(new Date(date))
    const when = left < 0 ? t('companies_ended_ago').replace('{days}', days(-left))
        : left === 0 ? t('companies_ends_today')
        : t('companies_ends_in').replace('{days}', days(left))
    // Each kept apart from the next, so the date can't swap places with the words in Arabic.
    return <span>{[day, when].filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
}
