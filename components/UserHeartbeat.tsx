'use client'

import { useSession, signOut } from "next-auth/react"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useLanguage } from "@/context/LanguageContext"

export default function UserHeartbeat() {
    const { data: session } = useSession()
    const { t } = useLanguage()
    const router = useRouter()
    const pathname = usePathname()

    const [isSuspended, setIsSuspended] = useState(false)
    const [isCompanyBanned, setIsCompanyBanned] = useState(false)
    const [showMaintenanceOverlay, setShowMaintenanceOverlay] = useState(false)
    const [maintenanceMessage, setMaintenanceMessage] = useState<string | null | undefined>(null)
    // Mirrors whether maintenance was already known active, without the
    // stale-closure problem a state read inside checkStatus below would
    // have — checkStatus is only recreated when `session` changes, not on
    // every state update, so it needs a ref to see its own latest writes.
    const wasMaintenanceActive = useRef(false)

    useEffect(() => {
        if (!session?.user) return

        const checkStatus = async () => {
            try {
                const res = await fetch('/api/user/activity', { method: 'POST' })
                const result = await res.json()
                const data = result.data

                if (data.status === 'SUSPENDED') {
                    // 1. Trigger Auto-Save in listeners
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))

                    // 2. Show Modal
                    setIsSuspended(true)

                    // 3. Logout after delay
                    setTimeout(() => {
                        signOut({ callbackUrl: '/login' })
                    }, 4000)
                } else if (data.status === 'COMPANY_BANNED') {
                    // 1. Trigger Auto-Save in listeners
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))

                    // 2. Show Modal
                    setIsCompanyBanned(true)

                    // 3. Logout after delay
                    setTimeout(() => {
                        signOut({ callbackUrl: '/login' })
                    }, 4000)
                } else if (data.status === 'MAINTENANCE') {
                    if (!wasMaintenanceActive.current) {
                        wasMaintenanceActive.current = true
                        setMaintenanceMessage(data.maintenanceMessage)
                        if (pathname !== '/dashboard/maintenance') setShowMaintenanceOverlay(true)

                        // Same auto-save signal as suspension/ban — the listeners
                        // in tasks/[id]/client.tsx and obligations/[id]/client.tsx
                        // don't care why they were told to save, just that they were.
                        window.dispatchEvent(new CustomEvent('app:suspend-detected'))

                        // Unlike suspension/ban this isn't a dead end — the
                        // account is fine, so redirect to the holding page
                        // instead of signing out. That page polls the same
                        // way and brings the user back on its own once
                        // maintenance ends. Only fires once per activation,
                        // not on every 2-minute poll while it stays on.
                        setTimeout(() => {
                            setShowMaintenanceOverlay(false)
                            if (pathname !== '/dashboard/maintenance') {
                                router.push('/dashboard/maintenance')
                            }
                        }, 4000)
                    }
                } else if (wasMaintenanceActive.current) {
                    // Maintenance ended since the last check.
                    wasMaintenanceActive.current = false
                    setShowMaintenanceOverlay(false)
                    setMaintenanceMessage(null)
                }
            } catch (error) {
                console.error('Heartbeat failed', error)
            }
        }

        // Initial ping
        checkStatus()

        // Every 15 seconds — was 2 minutes, but that made maintenance mode
        // feel broken: this live DB check (plus the 4s auto-save grace
        // period after it) is the only thing that actually moves a user off
        // a page on its own, since a stale session-token cookie won't get
        // middleware to redirect until something else happens to refresh
        // it. Same logic now also propagates a suspension/ban faster too.
        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return
            checkStatus()
        }, 15000)

        return () => clearInterval(interval)
        // Deliberately keyed only on session — router/pathname change on
        // every navigation, and this interval must survive route changes
        // rather than being torn down and restarted on every click.
        // checkStatus's pathname check is a best-effort UX nicety (skip a
        // redundant push if already on the maintenance page); it can go
        // stale across navigations between session refreshes, but that's
        // harmless — middleware.ts is the actual enforcement and checks the
        // JWT fresh on every request regardless of this component's state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session])

    if (isSuspended || isCompanyBanned) {
        return (
            <div style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.85)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                flexDirection: 'column',
                gap: '1rem',
                textAlign: 'center',
                padding: '2rem'
            }}>
                <h1 style={{ color: '#ef4444', fontSize: '2rem', margin: 0 }}>
                    {isSuspended ? t('account_suspended') : t('company_banned')}
                </h1>
                <p style={{ fontSize: '1.1rem', maxWidth: '500px' }}>
                    {isSuspended
                        ? t('suspension_msg')
                        : t('banned_msg')}
                </p>
                <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>{t('logging_out_msg')}</p>
                <div style={{
                    width: '30px',
                    height: '30px',
                    border: '3px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#ef4444',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                }}></div>
            </div>
        )
    }

    if (showMaintenanceOverlay) {
        return (
            <div style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.85)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                flexDirection: 'column',
                gap: '1rem',
                textAlign: 'center',
                padding: '2rem'
            }}>
                <span style={{ fontSize: '3rem' }}>🔧</span>
                <h1 style={{ color: '#f59e0b', fontSize: '2rem', margin: 0 }}>
                    {t('maintenance_detected_title')}
                </h1>
                <p style={{ fontSize: '1.1rem', maxWidth: '500px' }}>
                    {maintenanceMessage || t('maintenance_detected_msg')}
                </p>
                <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>{t('maintenance_saving_msg')}</p>
                <div style={{
                    width: '30px',
                    height: '30px',
                    border: '3px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#f59e0b',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                }}></div>
            </div>
        )
    }

    return null
}
