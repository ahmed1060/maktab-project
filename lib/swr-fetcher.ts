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

/** Waits before a try again; one called off meanwhile isn't tried again. */
async function wait(ms: number, signal?: AbortSignal | null) {
    await new Promise(resolve => setTimeout(resolve, ms))
    if (signal?.aborted) throw signal.reason
}

/**
 * A load whose answer is read as part of each try, so a connection that
 * drops while the answer comes in is tried again too, as one that drops
 * before it (Codex on #84). A GET or HEAD that fails in a way that can pass
 * is tried again, three times (RETRY_DELAYS_MS), and `read` gets each try's
 * answer from its start: whatever it counts, it counts afresh. An answer
 * that's no good, such as a refusal, is read once, by `read`, and given
 * back. Anything else, a save above all, is sent once: sent again, it might
 * be done twice. One called off isn't tried again.
 */
export async function loadRetrying<T>(input: string, init: RequestInit | undefined, read: (res: Response) => Promise<T>): Promise<T> {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return read(await fetch(input, init))
    for (let attempt = 0; ; attempt++) {
        const delay = RETRY_DELAYS_MS[attempt]
        let res: Response
        try {
            res = await fetch(input, init)
        } catch (error) {
            if (delay === undefined || init?.signal?.aborted) throw error
            await wait(delay, init?.signal)
            continue
        }
        if (!res.ok && delay !== undefined && worthRetrying(res.status)) {
            await wait(delay, init?.signal)
            continue
        }
        if (!res.ok) return read(res)
        try {
            return await read(res)
        } catch (error) {
            if (delay === undefined || init?.signal?.aborted) throw error
        }
        await wait(delay, init?.signal)
    }
}

/** An answer with its body already in, so reading it later can't fail part way. */
async function readAhead(res: Response): Promise<Response> {
    if (!res.ok || !res.body) return res
    return new Response(await res.arrayBuffer(), { status: res.status, statusText: res.statusText, headers: res.headers })
}

/**
 * `fetch`, for anything a screen loads: tried again as loadRetrying says,
 * with the answer's body read as part of each try, and its last answer given
 * back, so a screen shows a failure only once those have failed too
 * (DESIGN.md §5.5). A download whose progress is shown reads its own body,
 * with loadRetrying.
 */
export const fetchRetrying = (input: string, init?: RequestInit): Promise<Response> => loadRetrying(input, init, readAhead)

export const fetcher = (url: string) => loadRetrying(url, { cache: 'no-store' }, async res => {
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
})
