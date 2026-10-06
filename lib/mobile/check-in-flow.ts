import { attestedText, checkInText, signedText } from "@/lib/attendance/signed-text"
import type { CheckInDevice } from "./native"
import { faceCheck, type FaceVerifier } from "./face"

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
    const [info, attestation] = await Promise.all([device.info(), device.attestation(attestedText("REGISTER", nonce), "REGISTER")])
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

/** A fix older than this when the face check ends is taken again: where the person is now, not when they tapped. */
export const FIX_FRESH_MS = 60_000
/** A number older than this is asked for again: it lasts five minutes, and signing and sending take a moment. */
export const NONCE_FRESH_MS = 4 * 60_000

/**
 * Checks in: the face check when it is in use for the person (§9.5), the
 * fix, the number and the attestation of it, and the face check's result
 * signed with the rest.
 *
 * The fix, the number and its attestation start at the tap, alongside the
 * face check, rather than one after another once it is done: in production
 * they added seven seconds after the camera closed. A face check that ran
 * long (the first one downloads the models) gets a fresh fix and number, so
 * neither is sent stale.
 */
export async function checkIn(device: CheckInDevice, post: Post, direction: "IN" | "OUT" | null, face?: FaceVerifier | null, now: () => number = Date.now): Promise<CheckInAnswer> {
    const publicKey = await device.publicKey()
    if (!publicKey) throw new Error("NO_PHONE_KEY")
    const keyFingerprint = await fingerprintOf(publicKey)
    const started = now()
    const early = { fix: device.location(), proof: proofOf(device, post) }
    early.fix.catch(() => {})
    let checked: Awaited<ReturnType<typeof faceCheck>> = null
    if (face) {
        try {
            checked = await faceCheck(device, face, post)
        } catch (e) {
            // The person closed the camera: nothing is sent. Anything else (the
            // SDK, the camera, the network) mustn't stop them checking in: it goes
            // without a face check, and waits for a review (review on #27).
            if (errorCode(e) === "FACE_CANCELLED") throw e
        }
    }
    const fresh = now() - started
    const fix = fresh > FIX_FRESH_MS ? await device.location() : await early.fix
    const { nonce, attestation } = fresh > NONCE_FRESH_MS ? await proofOf(device, post) : await early.proof
    const body = { nonce, keyFingerprint, ...fix, direction, ...(checked ? { face: checked.face } : {}) }
    const signature = await device.sign(checkInText(body))
    return post("/api/attendance/check-in", { ...body, signature, attestation, ...(checked?.frame ? { faceFrame: checked.frame } : {}) })
}

/** The number with its attestation, asked for now; a failure waits until it is awaited. */
function proofOf(device: CheckInDevice, post: Post) {
    const proof = (async () => {
        const { nonce } = await post("/api/attendance/phone/challenge", { purpose: "CHECK_IN" })
        return { nonce: nonce as string, attestation: await device.attestation(attestedText("CHECK_IN", nonce), "CHECK_IN") }
    })()
    // Not unhandled while the face check runs: the error comes out where it is awaited.
    proof.catch(() => {})
    return proof
}

/** The code a plugin rejected with (Capacitor puts it in `code`), or the message. */
export function errorCode(e: unknown): string | undefined {
    return (e as { code?: string })?.code ?? (e as Error)?.message
}
