import { getCsrfToken } from 'next-auth/react'

/**
 * Asks the server to write the session again with `data`, as next-auth's
 * update() does, whether or not the page's session has loaded. update() does
 * nothing while it's loading, so Save on the Change password page, pressed
 * then, left the session saying the password had to be changed, and the page
 * came back though it had been (PR 228). The server reads what it may trust
 * from the account, never from `data` (lib/auth.ts). Whether it took it.
 */
export async function refreshSession(data: Record<string, unknown>): Promise<boolean> {
    try {
        const csrfToken = await getCsrfToken()
        const res = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csrfToken, data }),
        })
        return res.ok
    } catch {
        return false
    }
}
