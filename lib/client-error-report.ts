'use client'

import * as Sentry from '@sentry/nextjs'

/**
 * Best-effort report of a client-side failure to /api/system/log-client-error
 * — the same "friendly message + super-admin-only detail" pattern the rest
 * of the app uses for server errors, extended to cover the two places a
 * server catch block never sees: a React render crash, and signIn() itself
 * throwing on the login page. Never throws — a failure reporting a failure
 * must not compound into a worse one for the user.
 */
/** Mirrors AuditLogService.friendlyErrorMessage server-side — same wording
 *  everywhere an unexpected error reaches a user, whether it was caught on
 *  the server or here on the client. */
export function friendlyErrorMessage(ref: string | null): string {
    return ref
        ? `We couldn't complete that action. Please try again — if it keeps happening, share this reference with your admin: ${ref}`
        : `We couldn't complete that action. Please try again.`
}

export async function reportClientError(error: unknown, route?: string, componentStack?: string): Promise<string | null> {
    // An error that reached here was caught by one of the app's boundaries,
    // so it never becomes an uncaught error Sentry would see by itself.
    const sentryId = captureInSentry(error, route, componentStack)
    try {
        const err = error as any
        const res = await fetch('/api/system/log-client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: err?.message || String(error),
                stack: typeof err?.stack === 'string' ? err.stack : undefined,
                componentStack,
                route: route || (typeof window !== 'undefined' ? window.location.pathname : undefined),
                sentryId,
            })
        })
        const data = await res.json().catch(() => null)
        return data?.data?.ref || null
    } catch {
        return null
    }
}

/** Never throws, and does nothing without a DSN. Returns Sentry's event id so
 *  the in-app reference and the Sentry issue can be matched up. */
function captureInSentry(error: unknown, route?: string, componentStack?: string): string | undefined {
    try {
        return Sentry.captureException(error, {
            tags: route ? { boundary: route } : undefined,
            contexts: componentStack ? { react: { componentStack } } : undefined,
        })
    } catch {
        return undefined
    }
}
