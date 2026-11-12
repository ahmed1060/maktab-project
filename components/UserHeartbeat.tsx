'use client'

import { useSession, signOut } from "next-auth/react"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useEffectEvent, useId, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { SignOutIcon, WrenchIcon } from "@phosphor-icons/react/ssr"
import { EmptyState, type PhosphorIcon } from "@/components/ui"
import { useLanguage } from "@/context/LanguageContext"
import { useDialog } from "@/lib/useDialog"
import { HEARTBEAT_MS } from "@/lib/presence"
import { createTabReporter, newTabId, type TabState } from "@/lib/tab-presence"
import { useLive } from "@/components/LiveUpdates"

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
    // The account check below, for the Realtime path to run once it has
    // connected (see there), and for a live signal about the account.
    const checkStatusRef = useRef<(() => void) | null>(null)
    // Live updates, part 3 (REALTIME_PLAN.md): the database says the account
    // can't go on, suspended, closed, deleted or its company banned, and this
    // asks at once rather than at the next beat. The beat stays, as the
    // safety net.
    useLive('account', () => { void checkStatusRef.current?.() })

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

    // What the server answers about the account, read with this render's
    // handlers: the reporter below lasts as long as the person is signed in,
    // and the page's address changes under it, which the handlers read.
    const onAccountState = useEffectEvent((data: { status?: string; maintenanceMessage?: string | null }) => {
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
    })

    // Who's online, part 6a (REALTIME_PLAN.md §3): this tab's own id, made as
    // its page loads and kept for that page only (lib/tab-presence.ts).
    const [tabId] = useState(newTabId)
    // Signed in as whom: the session itself is fetched again every 5 minutes,
    // each time a new object, and the reporter below mustn't start again with
    // it, saying "here" as it starts.
    const userId = session?.user?.id

    // This tab says when it's shown and when it goes (lib/tab-presence.ts),
    // and each answer says the account's state: suspension and ban detection,
    // and a slow safety net for maintenance mode in case the WebSocket above
    // ever drops silently. Part 3 and the maintenance channel make both
    // instant; the beat, every 15 minutes while the tab is shown, is the
    // safety net for them and for a tab whose leaving wasn't heard.
    useEffect(() => {
        if (!userId) return

        const report = async (state?: TabState) => {
            // Offline, or the page left mid-request, as on a page change: no
            // answer, so nothing to say, and the next beat asks again. It was
            // logged as "Heartbeat failed: TypeError: Failed to fetch" (PR 217).
            const res = await fetch('/api/user/activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Without a state, as a live signal about the account asks,
                // it only asks, and the tab's row is left as it is.
                body: JSON.stringify({ tab: tabId, state }),
            }).catch(() => null)
            // Refused, it has no answer to read: a 401 signs the page out
            // (AuthInterceptor), as a session the server ended gets.
            if (!res?.ok) return
            // Its answer cut off as the page is left: the same, nothing to say.
            const data = (await res.json().catch(() => null))?.data
            if (data) onAccountState(data)
        }

        const reporter = createTabReporter({
            isVisible: () => document.visibilityState === 'visible',
            send: (state) => { void report(state) },
            // Sent as text, which every browser's beacon takes and sends as the
            // page closes; the route reads it.
            beacon: (state) => { navigator.sendBeacon('/api/user/activity', JSON.stringify({ tab: tabId, state })) },
        })

        // Asks only the account's state, leaving the tab's row as it is.
        const checkStatus = () => { void report() }
        checkStatusRef.current = checkStatus
        // A tab opened out of sight has no row until it's looked at, and asks
        // only the account's state.
        if (document.visibilityState === 'visible') reporter.shown()
        else void report()

        const onVisibility = () => {
            if (document.visibilityState === 'visible') reporter.shown()
            else reporter.hidden()
        }
        // Closing, reloading, or going to another site. A page kept to come
        // back to (the browser's back and forward) says it's here again as
        // it's shown.
        const onPageHide = () => { reporter.closed() }
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted && document.visibilityState === 'visible') reporter.shown()
        }
        // Signing out ends the session before this page notices, and a report
        // sent after that is refused: DashboardHeader says so first.
        const onSigningOut = () => { reporter.closed() }
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('pagehide', onPageHide)
        window.addEventListener('pageshow', onPageShow)
        window.addEventListener('app:signing-out', onSigningOut)

        const interval = setInterval(() => {
            reporter.beat()
        }, HEARTBEAT_MS)

        return () => {
            clearInterval(interval)
            document.removeEventListener('visibilitychange', onVisibility)
            window.removeEventListener('pagehide', onPageHide)
            window.removeEventListener('pageshow', onPageShow)
            window.removeEventListener('app:signing-out', onSigningOut)
            // The page leaving the dashboard, or signed in as someone else:
            // this tab's row goes with it.
            reporter.closed()
            reporter.stop()
            checkStatusRef.current = null
        }
        // Keyed on who's signed in, and the tab's id, which never changes: it
        // survives route changes and the session's refresh every 5 minutes
        // rather than starting again with each.
    }, [userId, tabId])

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
