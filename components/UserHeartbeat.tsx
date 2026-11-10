'use client'

import { useSession, signOut } from "next-auth/react"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useId, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { SignOutIcon, WrenchIcon } from "@phosphor-icons/react/ssr"
import { EmptyState, type PhosphorIcon } from "@/components/ui"
import { useLanguage } from "@/context/LanguageContext"
import { useDialog } from "@/lib/useDialog"
import { HEARTBEAT_MS } from "@/lib/presence"

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
    const [isArchived, setIsArchived] = useState(false)
    const [isDeleted, setIsDeleted] = useState(false)
    const [showMaintenanceOverlay, setShowMaintenanceOverlay] = useState(false)
    const [maintenanceMessage, setMaintenanceMessage] = useState<string | null | undefined>(null)
    // Mirrors whether maintenance was already known active, without the
    // stale-closure problem a state read inside a callback recreated only
    // when `session` changes would have.
    const wasMaintenanceActive = useRef(false)
    // The polling effect's check, for the Realtime path to run once it has
    // connected (see there).
    const checkStatusRef = useRef<(() => void) | null>(null)

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
    //
    // The Supabase client is loaded here, when it is needed, rather than
    // imported at the top: it is most of a 270 KB script that every dashboard
    // page used to parse and run before it could respond — on a phone, a
    // good part of the half second the page was unresponsive (Lighthouse:
    // total blocking time) — for a channel a Super Admin never opens.
    useEffect(() => {
        if (!session?.user || session.user.role === 'SUPER_ADMIN') return
        let cleanup: (() => void) | undefined
        let cancelled = false
        import("@/lib/supabase-browser").then(({ getSupabaseBrowserClient }) => {
            if (cancelled) return
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
                // A broadcast sent before the channel connected isn't replayed,
                // and loading the client lazily widens that gap: ask once more
                // as soon as it is listening.
                .subscribe(state => { if (state === 'SUBSCRIBED') checkStatusRef.current?.() })
            cleanup = () => { supabase.removeChannel(channel) }
        }).catch(() => { /* the polling below still covers maintenance mode */ })

        return () => { cancelled = true; cleanup?.() }
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
            // Offline, or the page left mid-request, as on a page change: no
            // answer, so nothing to say, and the next beat asks again. It was
            // logged as "Heartbeat failed: TypeError: Failed to fetch" (PR 217).
            const res = await fetch('/api/user/activity', { method: 'POST' }).catch(() => null)
            // Refused, it has no answer to read: a 401 signs the page out
            // (AuthInterceptor), as a session the server ended gets.
            if (!res?.ok) return
            // Its answer cut off as the page is left: the same, nothing to say.
            const data = (await res.json().catch(() => null))?.data
            if (!data) return
            try {
                if (data.status === 'SUSPENDED') {
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))
                    setIsSuspended(true)
                    // Waits for the save (or the grace period) instead of a
                    // flat delay — a fixed 4s here is what raced a real
                    // save (upload + PUT) and lost it: signOut() cleared the
                    // session before the request that persists the work had
                    // even gone out. See waitForEmergencySave's comment.
                    waitForEmergencySave().then(() => signOut({ callbackUrl: '/login' }))
                } else if (data.status === 'ARCHIVED') {
                    // Same exit as a suspension — the emergency save still has
                    // to run, because a person whose last day this is may have
                    // unsaved work open — but a different screen. "Suspended"
                    // would read as a punishment to somebody who simply left.
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))
                    setIsArchived(true)
                    waitForEmergencySave().then(() => signOut({ callbackUrl: '/login' }))
                } else if (data.status === 'DELETED') {
                    // Deleted while signed in: the same exit, its own screen
                    // (PR 247). It went on working until then.
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))
                    setIsDeleted(true)
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

        checkStatusRef.current = checkStatus
        checkStatus()

        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return
            checkStatus()
        }, HEARTBEAT_MS)

        return () => { clearInterval(interval); checkStatusRef.current = null }
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

    // The screen over a page the app has to leave (DESIGN.md §5.5), over
    // everything, while the emergency save above runs. It was a dark screen
    // with a turning ring, titled in Title Case, that screen readers weren't
    // told of (PR 217).
    if (isSuspended || isCompanyBanned || isArchived || isDeleted) {
        const [title, why] = isArchived ? [t('account_archived'), t('archived_msg')]
            : isDeleted ? [t('account_deleted'), t('deleted_msg')]
                : isSuspended ? [t('account_suspended'), t('suspension_msg')]
                    : [t('company_banned'), t('banned_msg')]
        return createPortal(<LeavingCover icon={SignOutIcon} title={title} why={why} next={t('logging_out_msg')} />, document.body)
    }

    if (showMaintenanceOverlay) {
        // The Super Admins' message, when they wrote one, says why.
        return createPortal(<LeavingCover icon={WrenchIcon} title={t('maintenance_detected_title')} why={maintenanceMessage} next={t('maintenance_saving_msg')} />, document.body)
    }

    return null
}

/**
 * The screen over a page the app has to leave (DESIGN.md §5.5): the whole
 * screen in the page's colour, as the language switch's, with an empty state
 * in its middle: its icon, what happened, why, and what happens next. A
 * dialog with no buttons: the focus goes to it and stays, screen readers hear
 * it at once, and Escape does nothing, as there's nothing to go back to.
 */
export function LeavingCover({ icon, title, why, next }: { icon: PhosphorIcon; title: string; why?: string | null; next: string }) {
    // No onClose: Escape does nothing.
    const dialog = useDialog(true, undefined, { label: title })
    const detailId = useId()
    return (
        <div className="ui-cover">
            <div {...dialog.panelProps} role="alertdialog" aria-describedby={detailId} className="ui-cover-panel">
                {/* Why as it was written, in either language, as a maintenance message is (DESIGN.md §7). */}
                <EmptyState icon={icon} title={title} detail={<span id={detailId}>{why && <><span dir="auto">{why}</span><br /></>}{next}</span>} />
            </div>
        </div>
    )
}
