'use client'
import type { useRouter } from 'next/navigation'

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please log in again.'

/**
 * A stale/invalid session (e.g. a cookie encrypted under a rotated
 * NEXTAUTH_SECRET, or one that's simply timed out) fails withStandardHandler's
 * getServerSession() check the same way any other 401 does — but showing
 * "Failed to save draft" for that is actively misleading; there's nothing
 * wrong with what the user typed, they just need to log back in. Call this
 * instead of the usual error path whenever a mutating request comes back
 * 401, and it schedules the redirect after a short delay so the message is
 * actually readable first.
 */
export function redirectAfterSessionExpiry(router: ReturnType<typeof useRouter>, delayMs = 1800) {
    setTimeout(() => router.push('/login'), delayMs)
}
