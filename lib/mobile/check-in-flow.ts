import { checkInText, signedText } from "@/lib/attendance/signed-text"
import type { CheckInDevice } from "./native"

/**
 * The two things the app does with the server (ATTENDANCE_PLAN.md §9.2–§9.4),
 * step by step: ask for a one-time number, sign it with the phone's key, send.
 * The server checks everything again; these only put the request together
 * the way it expects. `post` sends JSON and gives back the response's data,
 * or throws with the message to show.
 */

export type Post = (url: string, body: unknown) => Promise<any>

/** The key's fingerprint as the server writes it: SHA-256 of the DER, in hex. */
export async function fingerprintOf(publicKeyBase64: string): Promise<string> {
    const der = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0))
    const digest = await crypto.subtle.digest("SHA-256", der)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("")
}

/** This phone's key fingerprint, or null when it has no key yet. */
export async function deviceFingerprint(device: CheckInDevice): Promise<string | null> {
    const key = await device.publicKey()
    return key ? fingerprintOf(key) : null
}

/**
 * Asks for this phone to be the one its owner checks in from. Always a new
 * key: one that was rejected or revoked once is never offered again.
 */
export async function registerPhone(device: CheckInDevice, post: Post) {
    const publicKey = await device.createKey()
    const fingerprint = await fingerprintOf(publicKey)
    const { nonce } = await post("/api/attendance/phone/challenge", { purpose: "REGISTER" })
    const signature = await device.sign(signedText("REGISTER", nonce, [fingerprint, device.platform]))
    const [info, attestation] = await Promise.all([device.info(), device.attestation(nonce)])
    return post("/api/attendance/phone/register", {
        nonce, publicKey, signature, platform: device.platform, model: info.model, appVersion: info.appVersion, attestation,
    })
}

export type CheckInAnswer =
    | { outcome: "REFUSED"; reason: string }
    | {
        outcome: "ACCEPTED" | "FLAGGED" | "HELD"; reasons: string[]; place: { id: string; name: string }; distanceMeters: number; at: string
        late: { minutes: number; startsAt: string } | null
    }

/**
 * Checks in: the fix first, so the number is asked for only once there is
 * something to sign — it lasts five minutes, and a slow fix shouldn't spend it.
 */
export async function checkIn(device: CheckInDevice, post: Post, direction: "IN" | "OUT" | null): Promise<CheckInAnswer> {
    const publicKey = await device.publicKey()
    if (!publicKey) throw new Error("NO_PHONE_KEY")
    const keyFingerprint = await fingerprintOf(publicKey)
    const fix = await device.location()
    const { nonce } = await post("/api/attendance/phone/challenge", { purpose: "CHECK_IN" })
    const body = { nonce, keyFingerprint, ...fix, direction }
    const [signature, attestation] = await Promise.all([device.sign(checkInText(body)), device.attestation(nonce)])
    return post("/api/attendance/check-in", { ...body, signature, attestation })
}
