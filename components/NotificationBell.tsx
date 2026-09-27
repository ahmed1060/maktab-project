"use client"

import { useState, useEffect, useRef } from "react"
import useSWR from "swr"
import { fetcher } from "@/lib/swr-fetcher"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/context/LanguageContext"
import { renderNotice, type NoticeParam } from "@/lib/notice"
import type { TranslationKey } from "@/lib/translations"

interface Notification {
    id: string
    type: string
    message: string
    messageKey?: string | null
    messageParams?: Record<string, NoticeParam> | null
    read: boolean
    // Null when the notification is addressed to a SuperAdmin instead of a
    // User. Only the employee-scoped routes below dereference it, and those
    // types are never sent to a SuperAdmin — but guard rather than assume.
    userId: string | null
    superAdminId: string | null
    relatedId: string | null
    createdAt: string
}

const NO_NOTIFICATIONS: Notification[] = []

export default function NotificationBell({ initialUnreadCount = 0 }: { initialUnreadCount?: number }) {
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const router = useRouter()
    const { t, locale } = useLanguage()
    // In the reader's language (lib/notice.ts). A row written before keys, or
    // with a key this version does not know, shows the English it was written with.
    const text = (n: Notification) => {
        if (!n.messageKey || !t(n.messageKey as TranslationKey)) return n.message
        return renderNotice({ key: n.messageKey as TranslationKey, params: n.messageParams ?? {} }, t, iso => new Date(iso).toLocaleDateString(locale, { timeZone: 'UTC' }))
    }

    // Polled every five minutes while the tab is visible (SWR skips hidden
    // tabs by default, which is what the visibility check here used to do).
    const { data, mutate } = useSWR('/api/notifications', fetcher, { refreshInterval: 300_000 })
    const notifications: Notification[] = data?.data || NO_NOTIFICATIONS
    // The server-rendered count stands in until the first answer arrives.
    const unreadCount = data ? notifications.filter(n => !n.read).length : initialUnreadCount

    const markAsRead = async () => {
        try {
            await fetch('/api/notifications', { method: 'PATCH' })
            // Mark the list we have as read without asking again; with no list
            // yet, ask — the answer now comes back all read.
            mutate(
                (current: any) => current ? { ...current, data: (current.data || []).map((n: Notification) => ({ ...n, read: true })) } : current,
                { revalidate: !data },
            )
        } catch (error) {
            console.error("Failed to mark notifications as read", error)
        }
    }

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    const toggleOpen = () => {
        if (!isOpen && unreadCount > 0) {
            markAsRead()
        }
        setIsOpen(!isOpen)
    }

    const handleNotificationClick = (notification: Notification) => {
        if (notification.relatedId) {
            setIsOpen(false)

            // Normalize type - handle subtypes like TASK_ASSIGNED, TASK_COMPLETED, etc.
            const type = notification.type.toUpperCase()

            // First: a role request's type must not fall through to the
            // REQUEST branch below, which reads an internal request's id.
            if (type.startsWith('ROLE_')) {
                if (notification.relatedId.startsWith('/')) router.push(notification.relatedId)
            } else if (type.includes('SUBSCRIPTION')) {
                // The first notification type a Super Admin can receive. Its
                // relatedId is a dashboard path (see checkSubscriptions), not an
                // entity id — the same convention NOTE uses below.
                if (notification.relatedId.startsWith('/')) {
                    router.push(notification.relatedId)
                }
            } else if (type.includes('TASK')) {
                router.push(`/dashboard/tasks?highlight=${notification.relatedId}`)
            } else if (type.includes('OBLIGATION')) {
                router.push(`/dashboard/obligations?highlight=${notification.relatedId}`)
            } else if (type.includes('DAY_OFF')) {
                router.push(`/dashboard/day-off-requests?highlight=${notification.relatedId}`)
            } else if (type.includes('BONUS') || type.includes('DEDUCTION')) {
                // Redirection to the user's own salary history
                if (!notification.userId) return
                router.push(`/dashboard/employees/${notification.userId}/history?highlight=${notification.relatedId}`)
            } else if (type.includes('PROFILE')) {
                // If it's a request, go to requests page. If it's a personal profile update, go to own profile.
                if (notification.message.toLowerCase().includes('request')) {
                    router.push(`/dashboard/profile-requests?highlight=${notification.relatedId}`)
                } else {
                    if (!notification.userId) return
                    router.push(`/dashboard/employees/${notification.userId}?highlight=${notification.relatedId}`)
                }
            } else if (type.includes('NOTE')) {
                // For notes, relatedId contains the dashboard path
                // We append the notification ID as highlight if the specific note ID isn't in the path
                if (notification.relatedId.startsWith('/')) {
                    const hasHighlight = notification.relatedId.includes('highlight=') || notification.relatedId.includes('noteId=')
                    let path = notification.relatedId

                    if (!hasHighlight) {
                        path = path.includes('?')
                            ? `${path}&highlight=${notification.id}`
                            : `${path}?highlight=${notification.id}`
                    }
                    router.push(path)
                }
            } else if (type.includes('TEAM')) {
                // relatedId is a dashboard path, the NOTE convention: the
                // employee's own profile, which shows their leader, or the
                // leader's team list.
                if (notification.relatedId.startsWith('/')) router.push(notification.relatedId)
            } else if (type.includes('REQUEST')) {
                // Fetch the current status of the request to determine redirection
                fetch(`/api/requests/${notification.relatedId}`)
                    .then(res => res.json())
                    .then(result => {
                        const request = result.data
                        const targetPage = request.status === 'COMPLETED' ? 'history' : ''
                        const path = targetPage
                            ? `/dashboard/requests/history?highlight=${notification.relatedId}`
                            : `/dashboard/requests?highlight=${notification.relatedId}`
                        router.push(path)
                    })
                    .catch(() => {
                        // Fallback to active requests if fetch fails
                        router.push(`/dashboard/requests?highlight=${notification.relatedId}`)
                    })
            }
        }
    }

    return (
        <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
                onClick={toggleOpen}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    position: 'relative',
                    fontSize: '1.5rem'
                }}
            >
                🔔
                {unreadCount > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: -5,
                        right: -5,
                        background: 'var(--danger-solid)',
                        color: 'var(--text-on-accent)',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 'bold'
                    }}>
                        {unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    [locale === 'ar' ? 'left' : 'right']: 0,
                    top: '100%',
                    width: 'min(300px, calc(100vw - 3rem))',
                    background: 'var(--surface)',
                    border: '1px solid var(--grey-200)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px var(--shadow-weak)',
                    zIndex: 1000,
                    maxHeight: '400px',
                    overflowY: 'auto'
                }}>
                    <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--grey-100)', fontWeight: 'bold' }}>
                        {t('notifications')}
                    </div>
                    {notifications.length === 0 ? (
                        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--grey-600)' }}>
                            {t('no_notifications')}
                        </div>
                    ) : (
                        notifications.map(notification => (
                            <div
                                key={notification.id}
                                onClick={() => handleNotificationClick(notification)}
                                style={{
                                    padding: '0.75rem',
                                    borderBottom: '1px solid var(--grey-100)',
                                    background: notification.read ? 'white' : 'var(--info-bg-sky)',
                                    cursor: notification.relatedId ? 'pointer' : 'default',
                                    transition: 'background 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                    if (notification.relatedId) {
                                        e.currentTarget.style.background = 'var(--info-bg)'
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = notification.read ? 'white' : 'var(--info-bg-sky)'
                                }}
                            >
                                <div style={{ fontSize: '0.875rem' }}>{text(notification)}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--grey-600)', marginTop: '0.25rem' }}>
                                    {new Date(notification.createdAt).toLocaleString(locale)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}
