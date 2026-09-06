'use client'

import { useSession, signOut } from "next-auth/react"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useRef, useState, useCallback } from "react"
import { useLanguage } from "@/context/LanguageContext"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"

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
    // stale-closure problem a state read inside a callback recreated only
    // when `session` changes would have.
    const wasMaintenanceActive = useRef(false)
    // Tracks the redirect timer so a real-time "maintenance ended" message
    // can cancel it if it arrives during the save grace period.
    const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Shared by both detection paths below (the fast Realtime broadcast and
    // the slow polling fallback) so activating maintenance behaves
    // identically regardless of which one noticed it first.
    const handleMaintenanceDetected = useCallback((message: string | null | undefined) => {
        if (wasMaintenanceActive.current) return
        wasMaintenanceActive.current = true
        setMaintenanceMessage(message)
        if (pathname !== '/dashboard/maintenance') setShowMaintenanceOverlay(true)

        // Same auto-save signal as suspension/ban — the listeners in
        // tasks/[id]/client.tsx and obligations/[id]/client.tsx don't care
        // why they were told to save, just that they were.
        window.dispatchEvent(new CustomEvent('app:suspend-detected'))

        // Unlike suspension/ban this isn't a dead end — the account is
        // fine, so redirect to the holding page instead of signing out.
        redirectTimer.current = setTimeout(() => {
            setShowMaintenanceOverlay(false)
            if (pathname !== '/dashboard/maintenance') {
                router.push('/dashboard/maintenance')
            }
        }, 4000)
    }, [pathname, router])

    const handleMaintenanceEnded = useCallback(() => {
        if (!wasMaintenanceActive.current) return
        wasMaintenanceActive.current = false
        if (redirectTimer.current) {
            clearTimeout(redirectTimer.current)
            redirectTimer.current = null
        }
        setShowMaintenanceOverlay(false)
        setMaintenanceMessage(null)
        if (pathname === '/dashboard/maintenance') router.push('/dashboard')
    }, [pathname, router])

    // Real-time path: an open WebSocket to a PUBLIC broadcast channel —
    // maintenance on/off isn't sensitive, so this needs no private-channel
    // authorization at all (a private channel would need a Supabase Auth
    // JWT, which this NextAuth-based app doesn't have — not worth the
    // complexity for a non-sensitive global flag). This is what makes
    // maintenance mode feel instant regardless of how many users are
    // connected, instead of everyone polling constantly to find out.
    // Super Admins are exempt from maintenance mode entirely, so they never
    // subscribe.
    useEffect(() => {
        if (!session?.user || session.user.role === 'SUPER_ADMIN') return
        const supabase = getSupabaseBrowserClient()
        if (!supabase) return // env vars not configured yet — polling below still covers it

        const channel = supabase.channel('maintenance-status')
        channel
            .on('broadcast', { event: 'update' }, ({ payload }) => {
                if (payload?.active) {
                    handleMaintenanceDetected(payload.message ?? null)
                } else {
                    handleMaintenanceEnded()
                }
            })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [session, handleMaintenanceDetected, handleMaintenanceEnded])

    // Polling path: suspension/ban detection, plus a slow safety net for
    // maintenance mode in case the WebSocket above ever drops silently.
    // Suspension/ban were never expected to feel instant — an admin doesn't
    // ban people continuously the way "is maintenance on" gets checked by
    // every idle tab — so this stays at the original, low-cost cadence
    // rather than the 15s this briefly used only to compensate for
    // maintenance mode before Realtime existed.
    useEffect(() => {
        if (!session?.user) return

        const checkStatus = async () => {
            try {
                const res = await fetch('/api/user/activity', { method: 'POST' })
                const result = await res.json()
                const data = result.data

                if (data.status === 'SUSPENDED') {
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))
                    setIsSuspended(true)
                    setTimeout(() => signOut({ callbackUrl: '/login' }), 4000)
                } else if (data.status === 'COMPANY_BANNED') {
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))
                    setIsCompanyBanned(true)
                    setTimeout(() => signOut({ callbackUrl: '/login' }), 4000)
                } else if (data.status === 'MAINTENANCE') {
                    handleMaintenanceDetected(data.maintenanceMessage)
                } else {
                    handleMaintenanceEnded()
                }
            } catch (error) {
                console.error('Heartbeat failed', error)
            }
        }

        checkStatus()

        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return
            checkStatus()
        }, 90000)

        return () => clearInterval(interval)
        // Deliberately keyed only on session — this interval must survive
        // route changes rather than being torn down and restarted on every
        // click. handleMaintenanceDetected/Ended are stable enough in
        // practice (only change with pathname) that omitting them here
        // just means this interval keeps using whichever pathname closure
        // it started with between session refreshes — harmless, since
        // middleware.ts is the actual enforcement and checks the JWT fresh
        // on every request regardless of this component's state.
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
