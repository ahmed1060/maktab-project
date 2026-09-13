"use client"

import { useLanguage } from "@/context/LanguageContext"

/**
 * The screen a locked company's Admin sees. Deliberately not an error page: the
 * account is intact, nothing has been deleted, and saying so is the difference
 * between a customer who renews and one who assumes their data is gone.
 */
export default function SubscriptionExpired({ lockedOn }: { lockedOn: string | null }) {
    const { t, locale } = useLanguage()

    const formatted = lockedOn
        ? new Date(lockedOn).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', {
            day: 'numeric', month: 'long', year: 'numeric',
        })
        : null

    return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 1rem' }}>
            <div className="glass-card" style={{ maxWidth: '34rem', width: '100%', padding: '2.5rem 2rem', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }} aria-hidden="true">⏳</div>

                <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.3rem' }}>
                    {t('subscription_expired_title' as any)}
                </h2>

                {formatted && (
                    <p style={{ color: 'var(--danger-fg-strong)', fontSize: '0.88rem', fontWeight: 600, margin: '0 0 1rem' }}>
                        {t('locked_on' as any)}: {formatted}
                    </p>
                )}

                <p style={{ color: 'var(--text-soft)', fontSize: '0.92rem', lineHeight: 1.65, margin: '0 0 1.25rem' }}>
                    {t('subscription_expired_body' as any)}
                </p>

                {/* The sentence that matters most on this page. A customer who
                    believes their records are gone does not renew. */}
                <div style={{
                    padding: '0.85rem 1rem', borderRadius: '0.6rem',
                    background: 'var(--ok-bg)', color: 'var(--ok-fg)',
                    fontSize: '0.88rem', fontWeight: 600,
                }}>
                    {t('subscription_expired_data_safe' as any)}
                </div>
            </div>
        </div>
    )
}
