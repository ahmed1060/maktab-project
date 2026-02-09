'use client'

import { useEffect } from 'react'
import { signOut } from 'next-auth/react'

/**
 * AuthInterceptor
 * 
 * Silently monkey-patches window.fetch to catch 401 Unauthorized responses.
 * If a 401 is detected (and it's not a NextAuth internal call), it forces 
 * a logout to prevent broken UI states when the session expires.
 */
export default function AuthInterceptor() {
    useEffect(() => {
        const { fetch: originalFetch } = window

        window.fetch = async (...args) => {
            const res = await originalFetch(...args)

            if (res.status === 401) {
                // Determine target URL for Loop Guard
                const targetUrl = typeof args[0] === 'string'
                    ? args[0]
                    : (args[0] as Request).url || ''

                // Loop Guard: Never intercept 401s from NextAuth internal endpoints
                // otherwise we create an infinite redirect loop.
                if (targetUrl && !targetUrl.includes('/api/auth/')) {
                    console.warn('[AuthInterceptor] 401 detected on:', targetUrl)
                    signOut({ callbackUrl: '/login' })
                }
            }

            return res
        }

        return () => {
            window.fetch = originalFetch
        }
    }, [])

    return null
}
