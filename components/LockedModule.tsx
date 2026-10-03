"use client"

import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { bundlesFor, BUNDLE_LABEL_KEYS, type Module } from '@/lib/features'

/**
 * What a customer sees where a module they have not bought would be.
 *
 * Visible and locked rather than hidden, deliberately: this is the sales
 * surface, and it is the only place a customer finds out what else the product
 * does. Hiding it means nobody ever asks to buy it.
 *
 * The counting happens server-side — the page that renders this records the
 * attempt — because a locked module already arrives as a real page request and
 * needs no client-side event to notice.
 */
export default function LockedModule({ module }: { module: Module }) {
    const { t } = useLanguage()
    const bundles = bundlesFor(module)
    // Attendance opens with either of its two add-ons, so it names both.
    const bundleName = bundles.map(b => t(BUNDLE_LABEL_KEYS[b] as any)).join(` ${t('or' as any)} `)
    const isHR = bundles.includes('HR')

    return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 1rem' }}>
            <div className="glass-card" style={{ maxWidth: '32rem', width: '100%', padding: '2.5rem 2rem', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }} aria-hidden="true">🔒</div>

                <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>
                    {t('module_locked_title' as any)}
                </h2>

                <p style={{ color: 'var(--text-soft)', fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
                    {t('module_locked_body' as any).replace('{bundle}', bundleName)}
                </p>

                <div style={{
                    display: 'inline-block', padding: '0.35rem 0.85rem', borderRadius: '999px',
                    fontSize: '0.8rem', fontWeight: 700, marginBottom: '1.5rem',
                    background: isHR ? 'var(--ok-bg)' : 'var(--info-bg)',
                    color: isHR ? 'var(--ok-fg)' : 'var(--info-fg)',
                }}>
                    {bundleName}
                </div>

                <div>
                    {/* Goes to the dashboard rather than back: "back" is the
                        locked page they just came from, which would loop. */}
                    <Link href="/dashboard" className="btn btn-secondary" style={{ fontSize: '0.88rem' }}>
                        {t('back_to_dashboard' as any)}
                    </Link>
                </div>
            </div>
        </div>
    )
}
