'use client'

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"

export default function UserHeartbeat() {
    const { data: session } = useSession()

    const [isSuspended, setIsSuspended] = useState(false)

    useEffect(() => {
        if (!session?.user) return

        const checkStatus = async () => {
            try {
                const res = await fetch('/api/user/activity', { method: 'POST' })
                const data = await res.json()

                if (data.status === 'SUSPENDED') {
                    // 1. Trigger Auto-Save in listeners
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))

                    // 2. Show Modal
                    setIsSuspended(true)

                    // 3. Logout after delay
                    setTimeout(() => {
                        signOut({ callbackUrl: '/login' })
                    }, 4000)
                }
            } catch (error) {
                console.error('Heartbeat failed', error)
            }
        }

        // Initial ping
        checkStatus()

        // Ping every 30 seconds
        const interval = setInterval(checkStatus, 30 * 1000)

        return () => clearInterval(interval)
    }, [session])

    if (isSuspended) {
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
                gap: '1rem'
            }}>
                <h1 style={{ color: '#ef4444', fontSize: '2rem', margin: 0 }}>Account Suspended</h1>
                <p>Your account has been suspended by an administrator.</p>
                <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>Saving your work and logging out...</p>
                <div className="spinner"></div> {/* Basic loading indicator idea */}
            </div>
        )
    }

    return null
}
