'use client'

import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import { useLanguage } from "@/context/LanguageContext"

export default function UserHeartbeat() {
    const { data: session } = useSession()
    const { t } = useLanguage()

    const [isSuspended, setIsSuspended] = useState(false)
    const [isCompanyBanned, setIsCompanyBanned] = useState(false)

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
                } else if (data.status === 'COMPANY_BANNED') {
                    // 1. Trigger Auto-Save in listeners
                    window.dispatchEvent(new CustomEvent('app:suspend-detected'))

                    // 2. Show Modal
                    setIsCompanyBanned(true)

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

        // Ping every 120 seconds (2 minutes)
        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return
            checkStatus()
        }, 120000)

        return () => clearInterval(interval)
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

    return null
}
