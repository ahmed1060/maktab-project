import { googleAccessToken, parseServiceAccount, type ServiceAccount } from "@/lib/google-auth"

/**
 * Google Play Integrity, checked on the server (ATTENDANCE_PLAN.md §9.4):
 * the app asks Google for a token over a nonce of ours; we have Google
 * decrypt it, then read the verdict. Classic requests: one per
 * registration or check-in, so the nonce can be our one-time number.
 *
 * Passes only when the token was made for our package, over our nonce, just
 * now; the app is the one Play installed (and signed with our key, when the
 * certificate is set); and the device passes Google's device integrity.
 */

export type PlayIntegrityConfig = {
    packageName: string
    account: ServiceAccount
    /** sha256 of our signing certificate(s), base64url as Google gives them; empty to skip the check. */
    certDigests: string[]
}

export type PlayIntegrityFailure =
    | "INVALID_TOKEN" | "UNAVAILABLE" | "WRONG_APP" | "NONCE_MISMATCH" | "STALE" | "APP_NOT_RECOGNIZED" | "WRONG_CERTIFICATE" | "DEVICE_NOT_TRUSTED"

/** Google's own clock and ours may differ a little; the token was asked for within the challenge's few minutes. */
const MAX_AGE_MS = 10 * 60_000
const SCOPE = "https://www.googleapis.com/auth/playintegrity"

const DEFAULT_PACKAGE = "com.shsd.nizmo"

/** From the environment; null when there is no service account to ask Google with. */
export function playIntegrityConfig(env: Record<string, string | undefined> = process.env): PlayIntegrityConfig | null {
    const account = parseServiceAccount(env.PLAY_INTEGRITY_SERVICE_ACCOUNT ?? env.FCM_SERVICE_ACCOUNT)
    if (!account) return null
    const certDigests = (env.PLAY_INTEGRITY_CERT_SHA256 ?? "").split(",").map(d => normalizeDigest(d.trim())).filter(Boolean)
    return { packageName: env.ATTENDANCE_ANDROID_PACKAGE || DEFAULT_PACKAGE, account, certDigests }
}

/**
 * Certificates are shown as hex with colons (Play Console, keytool) and
 * given by Google as base64url; either is accepted and compared as bytes.
 */
function normalizeDigest(value: string): string {
    if (!value) return ""
    const hex = value.replace(/:/g, "")
    const bytes = /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, "hex") : Buffer.from(value, "base64url")
    return bytes.toString("base64url")
}

/** Base64 of either alphabet, padded or not, as bytes; Google may give the nonce back re-encoded. */
const bytesOf = (value: string) => Buffer.from(value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "base64url")

type Verdict = {
    requestDetails?: { requestPackageName?: string; nonce?: string; timestampMillis?: string | number }
    appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[] }
    deviceIntegrity?: { deviceRecognitionVerdict?: string[] }
}

export async function verifyPlayIntegrity(input: {
    token: string; nonce: Buffer; config: PlayIntegrityConfig; fetchImpl?: typeof fetch; now?: Date
}): Promise<{ ok: true } | { ok: false; reason: PlayIntegrityFailure }> {
    const { config } = input
    const fetchImpl = input.fetchImpl ?? fetch
    const now = (input.now ?? new Date()).getTime()
    let verdict: Verdict
    try {
        const access = await googleAccessToken(config.account, SCOPE, fetchImpl, now)
        const res = await fetchImpl(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(config.packageName)}:decodeIntegrityToken`, {
            method: "POST",
            headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
            body: JSON.stringify({ integrity_token: input.token }),
        })
        // A token Google can't read is the phone's doing; anything else, ours or Google's.
        if (res.status === 400) return { ok: false, reason: "INVALID_TOKEN" }
        if (!res.ok) return { ok: false, reason: "UNAVAILABLE" }
        verdict = ((await res.json()) as { tokenPayloadExternal?: Verdict }).tokenPayloadExternal ?? {}
    } catch {
        return { ok: false, reason: "UNAVAILABLE" }
    }

    const request = verdict.requestDetails ?? {}
    const app = verdict.appIntegrity ?? {}
    if (request.requestPackageName !== config.packageName) return { ok: false, reason: "WRONG_APP" }
    if (!request.nonce || !bytesOf(request.nonce).equals(input.nonce)) return { ok: false, reason: "NONCE_MISMATCH" }
    const at = Number(request.timestampMillis)
    if (!Number.isFinite(at) || Math.abs(now - at) > MAX_AGE_MS) return { ok: false, reason: "STALE" }
    if (app.appRecognitionVerdict !== "PLAY_RECOGNIZED") return { ok: false, reason: "APP_NOT_RECOGNIZED" }
    if (app.packageName !== config.packageName) return { ok: false, reason: "WRONG_APP" }
    if (config.certDigests.length > 0 && !(app.certificateSha256Digest ?? []).some(d => config.certDigests.includes(normalizeDigest(d)))) {
        return { ok: false, reason: "WRONG_CERTIFICATE" }
    }
    if (!(verdict.deviceIntegrity?.deviceRecognitionVerdict ?? []).includes("MEETS_DEVICE_INTEGRITY")) return { ok: false, reason: "DEVICE_NOT_TRUSTED" }
    return { ok: true }
}
