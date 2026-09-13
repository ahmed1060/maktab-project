"use client"

import { useSession } from "next-auth/react"
import { useLanguage } from "@/context/LanguageContext"

/**
 * The trial countdown and the grace warning.
 *
 * Every number here was computed on the server and travels on the session. The
 * browser never works out how long is left: a countdown the client computes is
 * a countdown a client can be wrong about, and this one decides whether
 * somebody thinks they still have time to pay.
 *
 * ACTIVE and LIFETIME show nothing. A banner that is always present is a banner
 * nobody reads, and there is nothing to say when a subscription is simply
 * working.
 */
export default function SubscriptionBanner() {
    const { data: session } = useSession()
    const { t, locale } = useLanguage()

    const subscription = session?.user?.subscription
    if (!subscription) return null

    const { state, date, daysRemaining } = subscription
    if (state !== 'TRIAL' && state !== 'GRACE') return null

    const formatted = date
        ? new Date(date).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', {
            day: 'numeric', month: 'long', year: 'numeric',
        })
        : ''

    const days = Math.max(0, daysRemaining ?? 0)
    const isGrace = state === 'GRACE'

    const message = isGrace
        ? t('grace_banner' as any).replace('{days}', String(days)).replace('{date}', formatted)
        : t('trial_banner' as any).replace('{days}', String(days)).replace('{date}', formatted)

    return (
        <div
            // Announced rather than merely coloured: a red box means nothing to
            // somebody using a screen reader, and grace is the one message the
            // customer cannot afford to miss.
            role={isGrace ? 'alert' : 'status'}
            style={{
                margin: '0 0 1.25rem',
                padding: '0.85rem 1.1rem',
                borderRadius: '0.75rem',
                fontSize: '0.9rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                border: `1px solid ${isGrace ? 'var(--danger-border-firm)' : 'var(--info-bg-sky-firm)'}`,
                background: isGrace ? 'var(--danger-bg)' : 'var(--info-bg)',
                color: isGrace ? 'var(--danger-fg)' : 'var(--info-fg-deep)',
                direction: locale === 'ar' ? 'rtl' : 'ltr',
            }}
        >
            <span aria-hidden="true" style={{ fontSize: '1.1rem' }}>{isGrace ? '⚠️' : '🎁'}</span>
            <span>{message}</span>
        </div>
    )
}
