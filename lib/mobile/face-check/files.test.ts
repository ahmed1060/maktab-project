import { describe, it, expect, vi, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { joined, manifestOf, onPhone, runtime, MODELS_URL, ORT_WASM, SMALL_FILES, type Manifest } from "./files"

/**
 * Getting the models to the phone (review on #47): the recognition model's
 * parts one at a time, and every way the download can fail named the same.
 */

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

/** Lets each wait between tries again pass (DESIGN.md §5.5). */
async function settle<T>(run: Promise<T>) {
    vi.useFakeTimers()
    const outcome = run.then(value => ({ value }), error => ({ error }))
    for (let i = 0; i < 4; i++) await vi.runAllTimersAsync()
    vi.useRealTimers()
    return outcome as Promise<{ value?: T; error?: unknown }>
}

const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]
const whole = new Uint8Array([1, 2, 3, 4, 5, 6])
const manifest = (sha256 = createHash("sha256").update(whole).digest("hex")): Manifest => ({
    files: { "m.onnx": { parts: ["m.onnx.part0", "m.onnx.part1", "m.onnx.part2"], size: whole.length, sha256 } },
    total: whole.length,
})

/** A site serving the parts slowly, counting how many downloads are under way at once. */
function site() {
    const s = { open: 0, most: 0 }
    vi.stubGlobal("fetch", async (url: string) => {
        s.open++
        s.most = Math.max(s.most, s.open)
        await new Promise(r => setTimeout(r, 5))
        s.open--
        const i = Number(url.at(-1))
        return new Response(parts[i])
    })
    return s
}

describe("joining the model's parts", () => {
    it("downloads them one at a time, into place, and checks the whole", async () => {
        const s = site()
        let bytes = 0
        expect(await joined(manifest(), "m.onnx", n => { bytes += n })).toEqual(whole)
        expect(s.most).toBe(1)
        expect(bytes).toBe(whole.length)
    })

    it("refuses a model that isn't the one published", async () => {
        site()
        await expect(joined(manifest("0".repeat(64)), "m.onnx", () => {})).rejects.toMatchObject({ code: "FACE_MODELS_CORRUPT" })
    })

    it("tries a part again when the connection drops, and carries on", async () => {
        const answers: (() => Response)[] = [() => { throw new TypeError("Failed to fetch") }, ...parts.map(p => () => new Response(p))]
        const fetchMock = vi.fn(async () => answers.shift()!())
        vi.stubGlobal("fetch", fetchMock)
        expect(await settle(joined(manifest(), "m.onnx", () => {}))).toEqual({ value: whole })
        expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it("says the models are unavailable when a part can't be downloaded, after three tries again", async () => {
        const fetchMock = vi.fn(async () => { throw new TypeError("Failed to fetch") })
        vi.stubGlobal("fetch", fetchMock)
        expect((await settle(joined(manifest(), "m.onnx", () => {}))).error).toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        expect(fetchMock).toHaveBeenCalledTimes(4)
    })
})

describe("the manifest", () => {
    it("says the models are unavailable, whatever went wrong", async () => {
        vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch") })
        expect((await settle(manifestOf())).error).toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        // Not published (the face check is off there): the site's 404 page.
        vi.stubGlobal("fetch", async () => new Response("<html>Not found</html>", { status: 404 }))
        await expect(manifestOf()).rejects.toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        vi.stubGlobal("fetch", async () => new Response("<html>hello</html>"))
        await expect(manifestOf()).rejects.toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify(manifest())))
        expect(await manifestOf()).toEqual(manifest())
    })
})

/** The phone's Cache Storage, in memory: like the real one, it matches addresses without their #fragment. */
function phoneCache() {
    const store = new Map<string, ArrayBuffer>()
    const key = (k: string) => k.split("#")[0]
    const cache = {
        match: async (k: string) => (store.has(key(k)) ? new Response(store.get(key(k))!.slice(0)) : undefined),
        put: async (k: string, r: Response) => { store.set(key(k), await r.arrayBuffer()) },
        delete: async (k: string) => store.delete(key(k)),
    }
    vi.stubGlobal("caches", { open: async () => cache })
    return store
}

describe("checking the model once", () => {
    it("hashes the joined model when it was downloaded, and not again when it all comes from the phone", async () => {
        phoneCache()
        const s = site()
        const digest = vi.spyOn(crypto.subtle, "digest")
        expect(await joined(manifest(), "m.onnx", () => {})).toEqual(whole)
        expect(digest).toHaveBeenCalledTimes(1)
        // The next app start: every part from the phone, already checked together.
        expect(await joined(manifest(), "m.onnx", () => {})).toEqual(whole)
        expect(digest).toHaveBeenCalledTimes(1)
        expect(s.most).toBe(1)
        digest.mockRestore()
    })

    it("downloads a new model's parts afresh, never reading an older model's (review on #48)", async () => {
        phoneCache()
        let fetched = 0
        vi.stubGlobal("fetch", async (url: string) => { fetched++; return new Response(parts[Number(url.at(-1))]) })
        await joined(manifest(), "m.onnx", () => {})
        expect(fetched).toBe(3)
        // The same part names, for a different model: a cache miss, so its parts come from the site.
        await expect(joined(manifest("f".repeat(64)), "m.onnx", () => {})).rejects.toMatchObject({ code: "FACE_MODELS_CORRUPT" })
        expect(fetched).toBe(6)
    })
})

describe("whether the models are on the phone", () => {
    it("only when every part, every check and every small model is (review on #48)", async () => {
        const store = phoneCache()
        site()
        await joined(manifest(), "m.onnx", () => {})
        // The large model is in and checked, but not the small ones: a load would still download.
        expect(await onPhone(manifest())).toBe(false)
        for (const f of SMALL_FILES) store.set(`${MODELS_URL}/${f}`, new ArrayBuffer(1))
        expect(await onPhone(manifest())).toBe(true)
        // A part gone from the cache since: not on the phone.
        store.delete([...store.keys()].find(k => k.includes("part1"))!)
        expect(await onPhone(manifest())).toBe(false)
    })
})

describe("the runtimes' WebAssembly", () => {
    const wasm = new Uint8Array([0, 97, 115, 109, 1])
    const withRuntime = (sha256 = createHash("sha256").update(wasm).digest("hex")): Manifest => ({
        ...manifest(), runtime: { [ORT_WASM]: { size: wasm.length, sha256 } },
    })

    it("is kept on the phone like the models: downloaded once, checked, then from the phone (review on #48)", async () => {
        phoneCache()
        let fetched = 0
        vi.stubGlobal("fetch", async () => { fetched++; return new Response(wasm) })
        let bytes = 0
        expect(new Uint8Array(await runtime(withRuntime(), ORT_WASM, n => { bytes += n }))).toEqual(wasm)
        expect(new Uint8Array(await runtime(withRuntime(), ORT_WASM, () => {}))).toEqual(wasm)
        // Not left to the browser's own cache, which a phone's web view keeps small: once, for every check after.
        expect(fetched).toBe(1)
        expect(bytes).toBe(wasm.length)
    })

    it("refuses a download that isn't the one published, and keeps nothing of it", async () => {
        phoneCache()
        let fetched = 0
        vi.stubGlobal("fetch", async () => { fetched++; return new Response(wasm) })
        await expect(runtime(withRuntime("0".repeat(64)), ORT_WASM, () => {})).rejects.toMatchObject({ code: "FACE_MODELS_CORRUPT" })
        await expect(runtime(withRuntime("0".repeat(64)), ORT_WASM, () => {})).rejects.toMatchObject({ code: "FACE_MODELS_CORRUPT" })
        expect(fetched).toBe(2)
    })

    it("counts in whether everything is on the phone: without it, a load ahead of the camera downloads", async () => {
        const store = phoneCache()
        site()
        await joined(withRuntime(), "m.onnx", () => {})
        for (const f of SMALL_FILES) store.set(`${MODELS_URL}/${f}`, new ArrayBuffer(1))
        expect(await onPhone(withRuntime(), [ORT_WASM])).toBe(false)
        vi.stubGlobal("fetch", async () => new Response(wasm))
        await runtime(withRuntime(), ORT_WASM, () => {})
        expect(await onPhone(withRuntime(), [ORT_WASM])).toBe(true)
    })
})
