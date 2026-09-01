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
 */
export class SWRError extends Error {
    info?: any
    status?: number
}

export const fetcher = async (url: string) => {
    const res = await fetch(url, { cache: 'no-store' })
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
