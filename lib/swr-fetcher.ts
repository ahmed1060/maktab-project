/**
 * F-25: shared fetcher for useSWR across the dashboard's list pages.
 *
 * `cache: 'no-store'` matches what every one of these pages already
 * passed to `fetch()` before this migration — SWR does its own
 * deduplication/revalidation layer above the network, so the browser's
 * HTTP cache doesn't need to do double duty here.
 *
 * Throws on a non-OK response so SWR's `error` state actually fires
 * instead of resolving with a JSON error body as if it were data —
 * callers read `error` to distinguish "still loading" from "the request
 * failed" (see each page's SWRError usage).
 *
 * A failure that can pass is tried again first (fetchRetrying), so a
 * screen says it didn't load only once those have failed too (DESIGN.md
 * §5.5). SWR's own retrying is off (app/providers.tsx): it would show the
 * error while it retried.
 */
export class SWRError extends Error {
    info?: any
    status?: number
}

/** How long before each try again: three of them, after the first. */
export const RETRY_DELAYS_MS = [500, 1000, 2000] as const

/**
 * Whether a failure can pass by trying again: no answer at all (the
 * connection dropped), the server's own error, a timeout, or the server too
 * busy. A refusal or "not found" is the answer, and trying again would only
 * delay it.
 */
export const worthRetrying = (status: number | undefined) => status === undefined || status >= 500 || status === 408 || status === 429

/**
 * `fetch`, for anything a screen loads: a GET that fails in a way that can
 * pass is tried again, three times (RETRY_DELAYS_MS), and its last answer is
 * given back, so a screen shows a failure only once those have failed too
 * (DESIGN.md §5.5). Anything else, a save above all, is sent once: sent
 * again, it might be done twice. One called off isn't tried again.
 */
export async function fetchRetrying(input: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return fetch(input, init)
    for (let attempt = 0; ; attempt++) {
        const delay = RETRY_DELAYS_MS[attempt]
        try {
            const res = await fetch(input, init)
            if (res.ok || delay === undefined || !worthRetrying(res.status)) return res
        } catch (error) {
            if (delay === undefined || init?.signal?.aborted) throw error
        }
        await new Promise(resolve => setTimeout(resolve, delay))
        if (init?.signal?.aborted) throw init.signal.reason
    }
}

export const fetcher = async (url: string) => {
    const res = await fetchRetrying(url, { cache: 'no-store' })
    if (!res.ok) {
        const error = new SWRError('Request failed')
        try {
            error.info = await res.json()
        } catch {
            // Non-JSON error body — leave info undefined.
        }
        error.status = res.status
        throw error
    }
    return res.json()
}
