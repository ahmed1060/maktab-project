"use client"

import { useLanguage } from "@/context/LanguageContext"
import { SUBSCRIPTION_STYLE, isGrandfathered } from "@/lib/subscription-display"
import type { SubscriptionState } from "@/lib/billing/state"

type Props = {
    state: SubscriptionState
    date?: string | null
    daysRemaining?: number | null
    /** Hidden on narrow surfaces where only the badge fits. */
    showDate?: boolean
}

/**
 * The state badge and its one date. Which date it is depends on the state —
 * trial end, subscription end, when grace runs out, when it locked — and the
 * server has already decided that; this only renders it.
 *
 * The date is never blank except where there genuinely is not one: a lifetime
 * subscription, and a grandfathered company. Both say so in words rather than
 * leaving a gap that reads as missing data.
 */
export default function SubscriptionBadge({ state, date, daysRemaining, showDate = true }: Props) {
    const { t, locale } = useLanguage()
    const style = SUBSCRIPTION_STYLE[state]
    if (!style) return null

    const grandfathered = isGrandfathered(state, date ?? null)
    const label = grandfathered ? t('state_grandfathered' as any) : t(style.labelKey as any)

    const formatted = date
        ? new Date(date).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', {
            day: 'numeric', month: 'short', year: 'numeric',
        })
        : null

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
            <span style={{
                padding: '0.25rem 0.6rem',
                borderRadius: '999px',
                fontSize: '0.72rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                background: grandfathered ? 'var(--surface-sunk)' : style.bg,
                color: grandfathered ? 'var(--text-muted)' : style.color,
            }}>
                {label}
            </span>

            {showDate && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-soft)', whiteSpace: 'nowrap' }}>
                    {formatted ?? (state === 'LIFETIME' ? `∞ ${t('never_expires' as any)}` : '—')}
                    {formatted && typeof daysRemaining === 'number' && (
                        <span style={{ color: daysRemaining < 0 ? 'var(--danger-fg-strong)' : daysRemaining <= 14 ? 'var(--warn-fg-mid)' : 'var(--text-faint)' }}>
                            {' · '}
                            {daysRemaining < 0
                                ? t('ended_days_ago' as any).replace('{days}', String(Math.abs(daysRemaining)))
                                : `${daysRemaining} ${t('days_left' as any)}`}
                        </span>
                    )}
                </span>
            )}
        </div>
    )
}
