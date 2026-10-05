'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Holding page for non-super-admin users while system-wide maintenance
 * mode is on (see SystemSettings.maintenanceMode). UserHeartbeat.tsx sends
 * people here after auto-saving whatever draft they had open — this page's
 * only job from there is to keep checking and bring them back on its own
 * the moment maintenance ends, so nobody has to remember to come back and
 * manually refresh.
 */
export default function MaintenancePage() {
    const { t, locale } = useLanguage()
    const router = useRouter()
    const [message, setMessage] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        const check = async () => {
            try {
                const res = await fetch('/api/user/activity', { method: 'POST' })
                const result = await res.json()
                const data = result.data
                if (cancelled) return

                if (data?.status === 'MAINTENANCE') {
                    setMessage(data.maintenanceMessage || null)
                } else {
                    // Maintenance ended — send them back where the rest of
                    // the dashboard already works normally again.
                    router.push('/dashboard')
                }
            } catch (error) {
                console.error('Maintenance check failed', error)
            }
        }

        check()
        // Faster than the background heartbeat's 2-minute interval — someone
        // sitting on this page specifically wants back in as soon as possible.
        const interval = setInterval(check, 15000)

        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [router])

    return (
        <div style={{
            minHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2rem',
            direction: locale === 'ar' ? 'rtl' : 'ltr'
        }}>
            <span aria-hidden="true" style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔧</span>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 0.75rem' }}>
                {t('maintenance_page_title')}
            </h1>
            <p style={{ fontSize: '1rem', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 0 1.5rem' }}>
                {message || t('maintenance_page_subtitle')}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                <div style={{
                    width: '18px',
                    height: '18px',
                    border: '2px solid var(--border)',
                    borderTopColor: 'var(--warn-solid)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                }} />
                {t('maintenance_page_checking')}
            </div>
        </div>
    )
}
