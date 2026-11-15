/**
 * The secret in the address a Hikvision terminal sends to
 * (ATTENDANCE_PLAN.md §17.2, PR 291).
 *
 * A terminal can't hold a token or sign a request: what it can be told is
 * an address. So the address carries the secret, 32 random bytes, and
 * Nizmo keeps only its sha256, as it does an agent's token. Whatever Nizmo
 * writes down or sends on about a request has the secret taken out first.
 *
 * Nothing here needs Node: the error tracker's edge configuration reads it
 * too.
 */

/** The route as its pattern: what stands in for an address with its secret in it. */
export const HIKVISION_ROUTE = "/api/terminals/hikvision/[secret]"

const SECRET_BYTES = 32
const SHAPE = /^[A-Za-z0-9_-]{43}$/

/** 32 random bytes, in the letters an address takes as they are. */
export function newPushSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Whether this could be a secret at all: asked before the database is. */
export function isPushSecret(candidate: string): boolean {
    return SHAPE.test(candidate)
}

const MARK = "/api/terminals/hikvision/"
/** Whatever follows the route's start, a secret or a guess at one, up to the end of that part of the address. */
const IN_AN_ADDRESS = /(\/api\/terminals\/hikvision\/)[^/?#\s"'\\<>]+/g

function scrub(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === "string") return value.includes(MARK) ? value.replace(IN_AN_ADDRESS, "$1[secret]") : value
    if (value === null || typeof value !== "object" || seen.has(value)) return value
    seen.add(value)
    if (Array.isArray(value)) {
        let changed = false
        const out = value.map(item => {
            const scrubbed = scrub(item, seen)
            if (scrubbed !== item) changed = true
            return scrubbed
        })
        return changed ? out : value
    }
    let out: Record<string, unknown> | null = null
    for (const [key, item] of Object.entries(value)) {
        const scrubbed = scrub(item, seen)
        if (scrubbed === item) continue
        out ??= { ...value }
        out[key] = scrubbed
    }
    return out ?? value
}

/**
 * The same text, or the same event for the error tracker, with the secret
 * taken out of every address in it. Handed back as it was when there is
 * none.
 */
export function withoutTerminalSecrets<T>(value: T): T {
    return scrub(value, new WeakSet()) as T
}
