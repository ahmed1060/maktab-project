'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Holding page for non-super-admin users while system-wide maintenance
 * mode is on (see SystemSettings.maintenanceMode). UserHeartbeat.tsx sends
 * people here after auto-saving whatever draft they had open — this page's
 * only job from there is to keep checking and bring them back on its own
 * the moment maintenance ends, so nobody has to remember to come back and
 * manually refresh.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the pages left): the page
 * header says what's happening and that they'll be taken back, and the Super
 * Admins' message, when they wrote one, is a card under it, as they typed
 * it. The message took the place of the line saying they'd be taken back, a
 * wrench emoji stood above the title, and a ring turned by itself while it
 * said "Checking...": nothing moves unless somebody acts (DESIGN.md §8).
 */
export default function MaintenancePage() {
    const { t } = useLanguage()
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
        <Page>
            <PageHeader title={t('maintenance_page_title')} subtitle={t('maintenance_page_subtitle')} />
            {message && (
                <Card title={t('maintenance_page_note')} role="status">
                    {/* As they typed it: left to right or right to left (DESIGN.md
                        §7), each line kept and a long link broken to fit, as a
                        task's description is. Plain, its lines ran together and
                        a link pushed a phone sideways (web interface audit, PR 187). */}
                    <p className="ui-prose" dir="auto">{message}</p>
                </Card>
            )}
        </Page>
    )
}
