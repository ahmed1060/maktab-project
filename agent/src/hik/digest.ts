import { createHash, randomBytes } from "node:crypto"

/**
 * HTTP digest authentication (RFC 7616), as a Hikvision terminal asks for
 * it (ATTENDANCE_PLAN.md §17.4): the terminal sends a challenge, and each
 * request answers it with a hash of the user, the password, the challenge
 * and the request. The password itself never travels.
 */

export type DigestAlgorithm = "MD5" | "SHA-256"

export type Challenge = {
    realm: string
    nonce: string
    opaque: string | null
    algorithm: DigestAlgorithm
    /** Always `auth`: a challenge that doesn't offer it can't be answered here. */
    qop: "auth"
    /** The nonce has run out, not the password: a new challenge is answered as the old one was. */
    stale: boolean
}

/** The challenge in a `WWW-Authenticate` header, or null when it is one this can't answer. */
export function parseChallenge(header: string | null | undefined): Challenge | null {
    if (!header || !/^\s*Digest\s/i.test(header)) return null
    const f: Record<string, string> = {}
    for (const m of header.replace(/^\s*Digest\s+/i, "").matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/gi)) f[m[1].toLowerCase()] = m[2] ?? m[3]
    if (!f.nonce || f.realm === undefined) return null
    // No algorithm named is MD5 (RFC 7616 §3.3).
    const named = (f.algorithm ?? "MD5").toUpperCase()
    if (named !== "MD5" && named !== "SHA-256") return null
    if (!(f.qop ?? "").split(",").map(q => q.trim().toLowerCase()).includes("auth")) return null
    return { realm: f.realm, nonce: f.nonce, opaque: f.opaque ?? null, algorithm: named, qop: "auth", stale: (f.stale ?? "").toLowerCase() === "true" }
}

const hash = (algorithm: DigestAlgorithm, s: string) => createHash(algorithm === "MD5" ? "md5" : "sha256").update(s, "utf8").digest("hex")

/** A value as a quoted string: what the protocol can't quote is left out, never smuggled. */
const quoted = (s: string) => `"${s.replace(/["\\\r\n]/g, "")}"`

/**
 * The `Authorization` header answering a challenge for one request. `nc` is
 * how many times this nonce has been answered, this time included; the
 * client's own nonce is random unless one is given (tests).
 */
export function digestAuthorization(a: { challenge: Challenge; user: string; password: string; method: string; uri: string; nc: number; cnonce?: string }): string {
    const { challenge: c } = a
    const cnonce = a.cnonce ?? randomBytes(16).toString("hex")
    const nc = a.nc.toString(16).padStart(8, "0")
    const ha1 = hash(c.algorithm, `${a.user}:${c.realm}:${a.password}`)
    const ha2 = hash(c.algorithm, `${a.method}:${a.uri}`)
    const response = hash(c.algorithm, `${ha1}:${c.nonce}:${nc}:${cnonce}:${c.qop}:${ha2}`)
    const parts = [
        `username=${quoted(a.user)}`, `realm=${quoted(c.realm)}`, `nonce=${quoted(c.nonce)}`, `uri=${quoted(a.uri)}`,
        `algorithm=${c.algorithm}`, `qop=${c.qop}`, `nc=${nc}`, `cnonce=${quoted(cnonce)}`, `response="${response}"`,
    ]
    if (c.opaque !== null) parts.push(`opaque=${quoted(c.opaque)}`)
    return `Digest ${parts.join(", ")}`
}
