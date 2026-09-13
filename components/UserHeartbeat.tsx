'use client'

import { useSession, signOut } from "next-auth/react"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useRef, useState, useCallback } from "react"
import { useLanguage } from "@/context/LanguageContext"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"

// How long to give tasks/[id]/client.tsx or obligations/[id]/client.tsx to
// finish an in-flight emergency save (upload + PUT) before giving up and
// acting anyway. Real-world testing found the naive fixed 4s delay this used
// to be raced the save itself: a pending-file upload alone took ~2s, then
// the PUT that actually persists the note/status hadn't even been sent yet
// when the timer fired sign-out/redirect and invalidated the session out
// from under it — the request that did eventually go out came back 401,
// and the work was silently lost. 8s comfortably covers that observed
// ~6s round trip with margin, while resolving() below still lets the common
// case (nothing to save on the current page) finish near-instantly instead
// of always waiting the full 8s.
const EMERGENCY_SAVE_GRACE_MS = 8000

// Resolves as soon as whichever task/obligation page is mounted reports it's
// done saving (see the 'app:emergency-save-complete' dispatch in
// tasks/[id]/client.tsx / obligations/[id]/client.tsx), or after the grace
// period elapses — covering both "nothing on this page needed saving" (that
// listener acks immediately) and "no such page is even mounted right now"
// (nobody ever acks, so this is the only signal).
function waitForEmergencySave(): Promise<void> {
    return new Promise((resolve) => {
        let done = false
        const finish = () => {
            if (done) return
            done = true
            window.removeEventListener('app:emergency-save-complete', onComplete)
            clearTimeout(timer)
            resolve()
        }
        const onComplete = () => finish()
        window.addEventListener('app:emergency-save-complete', onComplete)
        const timer = setTimeout(finish, EMERGENCY_SAVE_GRACE_MS)
    })
}

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
        // Waits for the save (or the grace period) rather than a flat
        // timer — see waitForEmergencySave's comment for why a fixed delay
        // here used to race the save itself and lose the user's work.
        waitForEmergencySave().then(() => {
            // Maintenance may have already ended again while we were
            // waiting (handleMaintenanceEnded already reset everything in
            // that case) — skip the now-stale redirect.
            if (!wasMaintenanceActive.current) return
            setShowMaintenanceOverlay(false)
            if (pathname !== '/dashboard/maintenance') {
                router.push('/dashboard/maintenance')
            }
        })
    }, [pathname, router])

    const handleMaintenanceEnded = useCallback(() => {
        if (!wasMaintenanceActive.current) return
        wasMaintenanceActive.current = false
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
                    // Waits for the save (or the grace period) instead of a
                    // flat delay — a fixed 4s here is what raced a real
                    // save (upload + PUT) and lost it: signOut() cleared the
                    // session before the request that persists the work had
                    // even gone out. See waitForEmergencySave's comment.
                    waitForEmergencySave().then(() => signOut({ callbackUrl: '/login' }))
                } else if (data.status === 'COMPANY_BANNED') {
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))
                    setIsCompanyBanned(true)
                    waitForEmergencySave().then(() => signOut({ callbackUrl: '/login' }))
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
                <h1 style={{ color: 'var(--danger-solid)', fontSize: '2rem', margin: 0 }}>
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
                    borderTopColor: 'var(--danger-solid)',
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
                <h1 style={{ color: 'var(--warn-solid)', fontSize: '2rem', margin: 0 }}>
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
                    borderTopColor: 'var(--warn-solid)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                }}></div>
            </div>
        )
    }

    return null
}
