/**
 * The face check's model files: fetched from this site (scripts/fetch-face-models.mjs)
 * and kept in the phone's Cache Storage after the first time. Used by the page and by
 * the recognition worker alike, so nothing here touches the page.
 */

export const MODELS_URL = "/face-models/v2"
const CACHE = "nizmo-face-models-v2"

/** How far the first download has got, 0 to 1, for the screen. */
export type OnProgress = (share: number) => void

export type Manifest = { files: Record<string, { parts: string[]; size: number; sha256: string }>; total: number }

export const unavailable = () => Object.assign(new Error("FACE_MODELS_UNAVAILABLE"), { code: "FACE_MODELS_UNAVAILABLE" })

const openCache = async () => (typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null)

/**
 * Bytes from the site, or from the phone's cache after the first time. `key` names
 * them in the cache (by default the address): a part's key carries its model's
 * checksum, so a new model never reads an old one's parts. `fresh` says whether
 * anything came from the network.
 */
export async function cached(url: string, onBytes?: (n: number) => void, key: string = url): Promise<{ bytes: ArrayBuffer; fresh: boolean }> {
    const cache = await openCache()
    const hit = await cache?.match(key)
    if (hit) {
        const bytes = await hit.arrayBuffer()
        onBytes?.(bytes.byteLength)
        return { bytes, fresh: false }
    }
    // Offline, or the connection dropped: the person is told the download failed, not a browser error.
    const res = await fetch(url).catch(() => { throw unavailable() })
    if (!res.ok || !res.body) throw unavailable()
    const chunks: Uint8Array[] = []
    const reader = res.body.getReader()
    for (;;) {
        const { done, value } = await reader.read().catch(() => { throw unavailable() })
        if (done) break
        chunks.push(value)
        onBytes?.(value.byteLength)
    }
    const bytes = await new Blob(chunks as BlobPart[]).arrayBuffer()
    await cache?.put(key, new Response(bytes)).catch(() => {})
    return { bytes, fresh: true }
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("")
const partKey = (part: string, sha256: string) => `${MODELS_URL}/${part}#${sha256.slice(0, 16)}`
const verifiedKey = (sha256: string) => `${MODELS_URL}/verified/${sha256}`

/**
 * A model served in parts, joined and checked against the manifest: a corrupted download is never run.
 * One part at a time, each copied straight into place, so a phone holds the model and one part, not
 * every part and the model too (review on #47).
 *
 * Checked once: the 174 MB recognition model took most of a second to hash at every app start. Once its
 * parts have passed together, the cache records it, and parts that all come from the cache again skip it.
 */
export async function joined(manifest: Manifest, name: string, onBytes: (n: number) => void): Promise<Uint8Array> {
    const entry = manifest.files[name]
    const cache = await openCache()
    const out = new Uint8Array(entry.size)
    let at = 0
    let fresh = false
    for (const p of entry.parts) {
        const part = await cached(`${MODELS_URL}/${p}`, onBytes, partKey(p, entry.sha256))
        fresh ||= part.fresh
        if (at + part.bytes.byteLength > entry.size) { at = -1; break }
        out.set(new Uint8Array(part.bytes), at)
        at += part.bytes.byteLength
    }
    const known = !fresh && at === entry.size && !!(await cache?.match(verifiedKey(entry.sha256)))
    if (!known) {
        if (at !== entry.size || hex(await crypto.subtle.digest("SHA-256", out)) !== entry.sha256) {
            // Drop the cached parts so the next try downloads them afresh.
            await Promise.all(entry.parts.map(p => cache?.delete(partKey(p, entry.sha256))))
            await cache?.delete(verifiedKey(entry.sha256))
            throw Object.assign(new Error("FACE_MODELS_CORRUPT"), { code: "FACE_MODELS_CORRUPT" })
        }
        await cache?.put(verifiedKey(entry.sha256), new Response("ok")).catch(() => {})
    }
    return out
}

/** What the site serves, never cached: offline, missing or not JSON is FACE_MODELS_UNAVAILABLE (review on #47). */
export async function manifestOf(): Promise<Manifest> {
    try {
        const res = await fetch(`${MODELS_URL}/manifest.json`, { cache: "no-store" })
        if (!res.ok) throw unavailable()
        const m = (await res.json()) as Manifest
        if (!m?.files || typeof m.total !== "number") throw unavailable()
        return m
    } catch {
        throw unavailable()
    }
}

/** Whether every model this manifest names is on the phone already, checked: loading them costs no download. */
export async function onPhone(manifest: Manifest): Promise<boolean> {
    const cache = await openCache()
    if (!cache) return false
    for (const entry of Object.values(manifest.files)) if (!(await cache.match(verifiedKey(entry.sha256)))) return false
    return true
}
