"use client"

import { useEffect, useId, useRef, useState, type RefObject } from "react"
import Link from "next/link"
import { BellIcon } from "@phosphor-icons/react/ssr"
import useSWR from "swr"
import { Button, Icon } from "@/components/ui"
import { fetcher } from "@/lib/swr-fetcher"
import { useLanguage } from "@/context/LanguageContext"
import { renderNotice, type NoticeParam } from "@/lib/notice"
import type { TranslationKey } from "@/lib/translations"
import { noticeTarget } from "@/lib/notice-target"
import { noticeAge, noticeExactTime } from "@/lib/notice-age"
import { noticeIcon } from "@/lib/notice-icon"
import { useNow } from "@/lib/useNow"
import { useLive } from "@/components/LiveUpdates"

export interface Notice {
    id: string
    type: string
    message: string
    messageKey?: string | null
    messageParams?: Record<string, NoticeParam> | null
    read: boolean
    priority?: 'NORMAL' | 'HIGH' | 'CRITICAL'
    // Null when the notification is addressed to a SuperAdmin instead of a
    // User. Only a notice of their own pay reads it, and those are never sent
    // to a SuperAdmin; lib/notice-target.ts guards rather than assumes.
    userId: string | null
    superAdminId: string | null
    relatedId: string | null
    createdAt: string
}

const NO_NOTICES: Notice[] = []

/** What /api/notifications answers. */
type NoticeList = { data?: Notice[] }

/**
 * A CRITICAL notice stays unread, red and at the top until what it is about
 * is dealt with: neither following it nor Mark all as read reads it
 * (ATTENDANCE_PLAN.md §13.4).
 */
export const pinned = (n: Pick<Notice, 'priority' | 'read'>) => n.priority === 'CRITICAL' && !n.read

/** The list the bell has, with those `pick` chooses read. */
const readIn = (current: NoticeList | undefined, pick: (n: Notice) => boolean) =>
    current ? { ...current, data: (current.data || []).map(n => pick(n) ? { ...n, read: true } : n) } : current

/**
 * The bell's panel (DESIGN.md §5.1): Notifications and Mark all as read at
 * its top, then each notification as a link to what it's about, with its
 * subject's icon, what it says and how long ago; tinted with a dot while
 * unread, and with an overdue row's look while it's one to deal with now.
 * Not a dialog: its button and links are Tab's, and the bell closes it.
 */
export function NotificationsPanel({ id, notices, status, now, onFollow, onMarkAll, onRetry, headingRef }: {
    id: string
    notices: Notice[]
    status: 'loading' | 'failed' | 'ready'
    now: number
    onFollow: (n: Notice) => void
    onMarkAll: () => void
    onRetry: () => void
    headingRef?: RefObject<HTMLHeadingElement | null>
}) {
    const { t, locale } = useLanguage()
    const headingId = `${id}-title`
    // In the reader's language (lib/notice.ts). A row written before keys, or
    // with a key this version does not know, shows the English it was written with.
    const text = (n: Notice) => {
        if (!n.messageKey || !t(n.messageKey as TranslationKey)) return n.message
        return renderNotice({ key: n.messageKey as TranslationKey, params: n.messageParams ?? {} }, t, iso => new Date(iso).toLocaleDateString(locale, { timeZone: 'UTC' }))
    }
    const canMarkAll = notices.some(n => !n.read && !pinned(n))

    return (
        <div id={id} className="ui-notices">
            <div className="ui-notices-head">
                {/* Where the focus goes once Mark all as read is used, as the button goes. */}
                <h2 id={headingId} ref={headingRef} tabIndex={-1} className="ui-notices-title">{t('notifications')}</h2>
                {status === 'ready' && canMarkAll && <Button variant="quiet" size="sm" onClick={onMarkAll}>{t('notifications_mark_all_read')}</Button>}
            </div>
            {status === 'loading' ? (
                <p className="ui-notices-note" role="status">{t('loading')}</p>
            ) : status === 'failed' ? (
                <div className="ui-notices-note" role="alert"><span>{t('notifications_load_failed')}</span><Button size="sm" onClick={onRetry}>{t('try_again')}</Button></div>
            ) : notices.length === 0 ? (
                <p className="ui-notices-note">{t('no_notifications')}</p>
            ) : (
                <ul className="ui-notices-list" aria-labelledby={headingId}>
                    {notices.map(n => {
                        const href = noticeTarget(n)
                        const unread = !n.read
                        const inside = (
                            <>
                                <span className="ui-notice-icon" aria-hidden="true"><Icon icon={noticeIcon(n.type)} size={16} /></span>
                                <span className="ui-notice-main">
                                    {unread && <span className="ui-visually-hidden">{t('notification_unread')} </span>}
                                    <span className="ui-notice-text">{text(n)}</span>
                                    <time className="ui-notice-time" dateTime={n.createdAt} title={noticeExactTime(n.createdAt, locale)}>{noticeAge(n.createdAt, now, locale, t('notice_just_now'))}</time>
                                </span>
                                {unread && <span className="ui-notice-dot" aria-hidden="true" />}
                            </>
                        )
                        return (
                            <li key={n.id} data-unread={unread || undefined} data-tone={pinned(n) ? 'overdue' : undefined}>
                                {href
                                    // A middle click opens it too, in a new tab.
                                    ? <Link href={href} className="ui-notice" onClick={() => onFollow(n)} onAuxClick={e => { if (e.button === 1) onFollow(n) }}>{inside}</Link>
                                    : <div className="ui-notice">{inside}</div>}
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

export default function NotificationBell({ initialUnreadCount = 0 }: { initialUnreadCount?: number }) {
    const [isOpen, setIsOpen] = useState(false)
    const box = useRef<HTMLDivElement>(null)
    const bellRef = useRef<HTMLButtonElement>(null)
    const headingRef = useRef<HTMLHeadingElement>(null)
    const panelId = useId()
    const { t, locale } = useLanguage()
    // So "10 minutes ago" moves on while the panel is open.
    const now = useNow()
    // The unread count in the page's own digits (DESIGN.md §7).
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

    // Polled every five minutes while the tab is visible (SWR skips hidden
    // tabs by default, which is what the visibility check here used to do).
    const { data, error, mutate } = useSWR<NoticeList>('/api/notifications', fetcher, { refreshInterval: 300_000 })
    // And at once when one arrives or is read in another tab (REALTIME_PLAN.md).
    useLive('notices', () => { void mutate() })
    const notices: Notice[] = data?.data || NO_NOTICES
    // The server-rendered count stands in until the first answer arrives.
    const unreadCount = data ? notices.filter(n => !n.read).length : initialUnreadCount

    const close = () => { setIsOpen(false); bellRef.current?.focus() }

    // Following one reads it: at once on screen, and on the server after,
    // which puts back what it has if that fails.
    const follow = (n: Notice) => {
        setIsOpen(false)
        if (n.read || pinned(n)) return
        mutate(current => readIn(current, x => x.id === n.id), { revalidate: false })
        fetch(`/api/notifications/${encodeURIComponent(n.id)}`, { method: 'PATCH', keepalive: true }).then(r => { if (!r.ok) mutate() }, () => mutate())
    }

    // The rest, but not one to deal with now. The button goes, so the focus
    // goes to the heading rather than to nowhere.
    const markAll = () => {
        mutate(current => readIn(current, x => !pinned(x)), { revalidate: false })
        headingRef.current?.focus()
        fetch('/api/notifications', { method: 'PATCH' }).then(r => { if (!r.ok) mutate() }, () => mutate())
    }

    // A click or a tap outside it closes it.
    useEffect(() => {
        if (!isOpen) return
        const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setIsOpen(false) }
        document.addEventListener('pointerdown', outside)
        return () => document.removeEventListener('pointerdown', outside)
    }, [isOpen])

    return (
        // Escape closes it from anywhere in it, the bell included. The focus
        // leaving it closes it, Tab past its last link among them; with no
        // element to go to (a click on nothing), the click outside does.
        <div ref={box} className="ui-bell"
            onKeyDown={e => { if (e.key === 'Escape' && isOpen) { e.preventDefault(); e.stopPropagation(); close() } }}
            onBlur={e => { if (e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setIsOpen(false) }}>
            {/* A round icon button on the top bar (DESIGN.md §5.1), named with
                how many are unread: the pill on it is hidden from screen
                readers, which hear it in the name instead. */}
            <button type="button" ref={bellRef} className="ui-topbar-button"
                aria-label={unreadCount > 0 ? `${t('notifications')}${t('top_bar_unread').replace('{count}', num(unreadCount))}` : t('notifications')}
                aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined} onClick={() => setIsOpen(open => !open)}>
                <Icon icon={BellIcon} className="ui-topbar-icon" />
                {unreadCount > 0 && <span className="ui-topbar-count" aria-hidden="true">{num(unreadCount)}</span>}
            </button>
            {isOpen && (
                <NotificationsPanel id={panelId} notices={notices} status={data ? 'ready' : error ? 'failed' : 'loading'} now={now}
                    onFollow={follow} onMarkAll={markAll} onRetry={() => mutate()} headingRef={headingRef} />
            )}
        </div>
    )
}
