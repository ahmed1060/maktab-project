"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

interface Notification {
    id: string
    type: string
    message: string
    read: boolean
    relatedId: string | null
    createdAt: string
}

export default function NotificationBell() {
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [isOpen, setIsOpen] = useState(false)
    const [unreadCount, setUnreadCount] = useState(0)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const router = useRouter()

    const fetchNotifications = async () => {
        try {
            const res = await fetch('/api/notifications')
            if (res.ok) {
                const data = await res.json()
                setNotifications(data)
                setUnreadCount(data.filter((n: Notification) => !n.read).length)
            }
        } catch (error) {
            console.error("Failed to fetch notifications", error)
        }
    }

    const markAsRead = async () => {
        try {
            await fetch('/api/notifications', { method: 'PATCH' })
            setNotifications(notifications.map(n => ({ ...n, read: true })))
            setUnreadCount(0)
        } catch (error) {
            console.error("Failed to mark notifications as read", error)
        }
    }

    useEffect(() => {
        fetchNotifications()
        const interval = setInterval(fetchNotifications, 60000) // Poll every minute
        return () => clearInterval(interval)
    }, [])

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
            // Determine if it's a task or obligation based on the notification type
            if (notification.type.includes('TASK')) {
                router.push(`/dashboard/tasks/${notification.relatedId}`)
            } else if (notification.type.includes('OBLIGATION')) {
                router.push(`/dashboard/obligations/${notification.relatedId}`)
            }
            setIsOpen(false)
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
                        background: 'red',
                        color: 'white',
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
                    right: 0,
                    top: '100%',
                    width: '300px',
                    background: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    zIndex: 1000,
                    maxHeight: '400px',
                    overflowY: 'auto'
                }}>
                    <div style={{ padding: '0.5rem', borderBottom: '1px solid #eee', fontWeight: 'bold' }}>
                        Notifications
                    </div>
                    {notifications.length === 0 ? (
                        <div style={{ padding: '1rem', textAlign: 'center', color: '#666' }}>
                            No notifications
                        </div>
                    ) : (
                        notifications.map(notification => (
                            <div
                                key={notification.id}
                                onClick={() => handleNotificationClick(notification)}
                                style={{
                                    padding: '0.75rem',
                                    borderBottom: '1px solid #eee',
                                    background: notification.read ? 'white' : '#f0f9ff',
                                    cursor: notification.relatedId ? 'pointer' : 'default',
                                    transition: 'background 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                    if (notification.relatedId) {
                                        e.currentTarget.style.background = '#e0f2fe'
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = notification.read ? 'white' : '#f0f9ff'
                                }}
                            >
                                <div style={{ fontSize: '0.875rem' }}>{notification.message}</div>
                                <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
                                    {new Date(notification.createdAt).toLocaleString()}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}
