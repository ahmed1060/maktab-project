import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { fetcher, fetchRetrying, RETRY_DELAYS_MS, SWRError } from "./swr-fetcher"

/**
 * A list or page that didn't load tries again by itself three times before
 * it says so (DESIGN.md §5.5): a moment's trouble with the connection or the
 * server shouldn't reach the screen. A refusal or "not found" is the answer,
 * and is said at once.
 */

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const failing = (status: number) => new Response(JSON.stringify({ error: "nope" }), { status })

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

/** Runs the fetcher to its end, letting each wait between tries pass. */
async function settle<T>(run: Promise<T>) {
    const outcome = run.then(value => ({ value }), error => ({ error }))
    for (let i = 0; i < RETRY_DELAYS_MS.length + 1; i++) await vi.runAllTimersAsync()
    return outcome as Promise<{ value?: T; error?: unknown }>
}

describe("loading a list's data", () => {
    it("tries again when the connection drops, and shows what the next try brings", async () => {
        vi.useFakeTimers()
        const answers = [() => { throw new TypeError("Failed to fetch") }, () => failing(503), () => ok({ data: [1] })]
        const fetchMock = vi.fn(async () => answers.shift()!())
        vi.stubGlobal("fetch", fetchMock)
        expect(await settle(fetcher("/api/clients"))).toEqual({ value: { data: [1] } })
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it("says it didn't load once three tries again have failed too, half a second, a second and two apart", async () => {
        vi.useFakeTimers()
        const at: number[] = []
        const fetchMock = vi.fn(async () => { at.push(Date.now()); return failing(500) })
        vi.stubGlobal("fetch", fetchMock)
        const { error } = await settle(fetcher("/api/clients"))
        expect(error).toBeInstanceOf(SWRError)
        expect((error as SWRError).status).toBe(500)
        expect((error as SWRError).info).toEqual({ error: "nope" })
        expect(fetchMock).toHaveBeenCalledTimes(4)
        expect(at.slice(1).map((t, i) => t - at[i])).toEqual([500, 1000, 2000])
    })

    it("says a refusal or \"not found\" at once, without trying again", async () => {
        for (const status of [400, 401, 403, 404, 409]) {
            const fetchMock = vi.fn(async () => failing(status))
            vi.stubGlobal("fetch", fetchMock)
            await expect(fetcher("/api/clients?id=x")).rejects.toMatchObject({ status })
            expect(fetchMock, String(status)).toHaveBeenCalledTimes(1)
        }
    })

    it("tries again when the server is too busy or timed out", async () => {
        vi.useFakeTimers()
        for (const status of [408, 429, 502]) {
            const answers = [() => failing(status), () => ok({ fine: true })]
            vi.stubGlobal("fetch", vi.fn(async () => answers.shift()!()))
            expect(await settle(fetcher("/api/x")), String(status)).toEqual({ value: { fine: true } })
        }
    })

    it("is the only retrying: SWR's own is off, as it would show the error while it retried", () => {
        expect(readFileSync("app/providers.tsx", "utf8")).toContain("shouldRetryOnError: false")
    })
})

describe("anything else a screen loads", () => {
    it("is tried again the same way, and the screen gets the answer as fetch gives it", async () => {
        vi.useFakeTimers()
        const answers = [() => { throw new TypeError("Failed to fetch") }, () => failing(502), () => ok({ data: "fine" })]
        const fetchMock = vi.fn(async () => answers.shift()!())
        vi.stubGlobal("fetch", fetchMock)
        const { value } = await settle(fetchRetrying("/api/users?role=TEAM_LEADER", { cache: "no-store" }))
        expect(value).toBeInstanceOf(Response)
        expect(await (value as Response).json()).toEqual({ data: "fine" })
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(fetchMock).toHaveBeenLastCalledWith("/api/users?role=TEAM_LEADER", { cache: "no-store" })
    })

    it("gives back the last answer once three tries again have failed, for the screen to say so", async () => {
        vi.useFakeTimers()
        const fetchMock = vi.fn(async () => failing(503))
        vi.stubGlobal("fetch", fetchMock)
        const { value } = await settle(fetchRetrying("/api/payslips/1"))
        expect((value as Response).status).toBe(503)
        expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it("gives a refusal or \"not found\" back at once", async () => {
        const fetchMock = vi.fn(async () => failing(404))
        vi.stubGlobal("fetch", fetchMock)
        expect((await fetchRetrying("/api/requests/gone")).status).toBe(404)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("never sends a save again: sent twice, it might be done twice", async () => {
        for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
            const fetchMock = vi.fn(async () => failing(503))
            vi.stubGlobal("fetch", fetchMock)
            expect((await fetchRetrying("/api/x", { method })).status, method).toBe(503)
            expect(fetchMock, method).toHaveBeenCalledTimes(1)
            vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
            await expect(fetchRetrying("/api/x", { method }), method).rejects.toThrow("Failed to fetch")
        }
    })

    it("isn't tried again once it's called off", async () => {
        const controller = new AbortController()
        const fetchMock = vi.fn(async () => { controller.abort(); throw new DOMException("Aborted", "AbortError") })
        vi.stubGlobal("fetch", fetchMock)
        await expect(fetchRetrying("/api/x", { signal: controller.signal })).rejects.toThrow("Aborted")
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
