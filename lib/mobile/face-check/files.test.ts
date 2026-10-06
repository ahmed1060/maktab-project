import { describe, it, expect, vi, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { joined, manifestOf, type Manifest } from "./files"

/**
 * Getting the models to the phone (review on #47): the recognition model's
 * parts one at a time, and every way the download can fail named the same.
 */

afterEach(() => { vi.unstubAllGlobals() })

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

    it("says the models are unavailable when a part can't be downloaded", async () => {
        vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch") })
        await expect(joined(manifest(), "m.onnx", () => {})).rejects.toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
    })
})

describe("the manifest", () => {
    it("says the models are unavailable, whatever went wrong", async () => {
        vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch") })
        await expect(manifestOf()).rejects.toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        // Not published (the face check is off there): the site's 404 page.
        vi.stubGlobal("fetch", async () => new Response("<html>Not found</html>", { status: 404 }))
        await expect(manifestOf()).rejects.toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        vi.stubGlobal("fetch", async () => new Response("<html>hello</html>"))
        await expect(manifestOf()).rejects.toMatchObject({ code: "FACE_MODELS_UNAVAILABLE" })
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify(manifest())))
        expect(await manifestOf()).toEqual(manifest())
    })
})

/** The phone's Cache Storage, in memory. */
function phoneCache() {
    const store = new Map<string, ArrayBuffer>()
    const cache = {
        match: async (k: string) => (store.has(k) ? new Response(store.get(k)!.slice(0)) : undefined),
        put: async (k: string, r: Response) => { store.set(k, await r.arrayBuffer()) },
        delete: async (k: string) => store.delete(k),
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

    it("never reads a part of an older model as a part of a new one", async () => {
        const store = phoneCache()
        site()
        await joined(manifest(), "m.onnx", () => {})
        // The same part names, for a different model: the old parts' keys don't match it.
        const other = manifest("f".repeat(64))
        await expect(joined(other, "m.onnx", () => {})).rejects.toMatchObject({ code: "FACE_MODELS_CORRUPT" })
        expect([...store.keys()].some(k => k.includes("ffffffffffffffff"))).toBe(false)
    })
})
