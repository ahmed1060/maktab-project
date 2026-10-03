import { attestedText, faceDeletedText, faceKeyText, faceText, type FaceResult } from "@/lib/attendance/signed-text"
import type { CheckInDevice } from "./native"
import { pendingTemplatesAction, type FaceStatus } from "./screen"
import type { Post } from "./check-in-flow"

/**
 * Face verification, as the app does it (ATTENDANCE_PLAN.md §9.5, §10.4).
 *
 * The matching is done on the phone by an on-device face SDK, behind the
 * app's second plugin, NizmoFace (mobile/README.md). Nothing about a face
 * goes to the SDK's maker, or to us, except the result of each check, one
 * verification photo for a person to approve, and the last frame of a check
 * that failed. The templates the SDK makes stay on the phone, encrypted with
 * a key that is half the phone's secure hardware and half a wrapping key
 * fetched from us at each use; destroying that half makes them unreadable.
 *
 * Until the SDK is in the app, there is no NizmoFace plugin: faceVerifier()
 * is null, nobody can enrol, and so nobody has face verification in use.
 */

/**
 * What the app needs from the face SDK.
 *
 * Templates live in two places on the phone: the approved ones, which every
 * check is made against, and new ones from an enrolment still waiting for a
 * person to approve its photo. Until then nobody has said the new face is
 * this person, so it is never matched against; on approval the new ones
 * replace the old (promote), on rejection they go (discardPending). So
 * check-ins keep working, against the approved face, while a
 * re-verification waits (ATTENDANCE_PLAN.md §9.5).
 */
export interface FaceVerifier {
    /** The SDK's model; whether approved templates are stored; whether new ones wait. */
    info(): Promise<{ modelVersion: string; enrolled: boolean; pending: boolean }>
    /**
     * Takes the person's face with a liveness check, keeps its templates on
     * the phone as the waiting ones, locked with this wrapping key, and gives
     * one verification photo: a JPEG in base64, at most 400 KB. The setup
     * photos are deleted.
     */
    enrol(wrappingKey: string): Promise<{ photo: string }>
    /**
     * Compares the face in front of the camera with the approved templates,
     * up to three tries. When it never matched, the last frame, a JPEG in
     * base64.
     */
    verify(wrappingKey: string): Promise<{ verified: boolean; score: number; liveness: number; attempts: number; frame: string | null }>
    /** The waiting templates become the approved ones, replacing those before. */
    promote(): Promise<void>
    /** Deletes the waiting templates. */
    discardPending(): Promise<void>
    /** Deletes every template, which can no longer be read anyway. */
    deleteTemplates(): Promise<void>
}

/** The plugin's methods as the native code exposes them (mobile/README.md). */
type NativeFacePlugin = {
    getInfo(): Promise<{ modelVersion: string; enrolled?: boolean; pending?: boolean }>
    enrol(options: { wrappingKey: string }): Promise<{ photo: string }>
    verify(options: { wrappingKey: string }): Promise<{ verified: boolean; score: number; liveness: number; attempts: number; frame?: string | null }>
    promote(): Promise<void>
    discardPending(): Promise<void>
    deleteTemplates(): Promise<void>
}

/** The face SDK, inside an app that has it; null otherwise. */
export function faceVerifier(): FaceVerifier | null {
    if (typeof window === "undefined") return null
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor
    if (!cap?.isNativePlatform?.() || !cap.Plugins?.NizmoFace) return null
    const plugin = cap.Plugins.NizmoFace as NativeFacePlugin
    return {
        info: async () => {
            const i = await plugin.getInfo()
            return { modelVersion: String(i.modelVersion).slice(0, 60), enrolled: !!i.enrolled, pending: !!i.pending }
        },
        enrol: wrappingKey => plugin.enrol({ wrappingKey }),
        verify: async wrappingKey => {
            const r = await plugin.verify({ wrappingKey })
            return { verified: !!r.verified, score: r.score, liveness: r.liveness, attempts: r.attempts, frame: r.frame ?? null }
        },
        promote: () => plugin.promote(),
        discardPending: () => plugin.discardPending(),
        deleteTemplates: () => plugin.deleteTemplates(),
    }
}

/** sha256 of base64 data, in hex, as the server writes it. */
export async function sha256OfBase64(data: string): Promise<string> {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("")
}

async function keyFingerprint(device: CheckInDevice): Promise<string> {
    const publicKey = await device.publicKey()
    if (!publicKey) throw new Error("NO_PHONE_KEY")
    // The fingerprint is the sha256 of the key's DER (fingerprintOf).
    return sha256OfBase64(publicKey)
}

/**
 * The wrapping key for this phone's templates, signed for by the phone. When
 * the server says the templates are to go (consent withdrawn, no longer
 * asked, purged), deletes them, says so, signed, and asks again: then there
 * is a new key or none. Null too while face verification is paused, with
 * the templates kept.
 */
export async function wrappingKey(device: CheckInDevice, face: FaceVerifier, post: Post): Promise<string | null> {
    const fingerprint = await keyFingerprint(device)
    const ask = async (): Promise<{ key: string | null; deleteTemplates: boolean }> => {
        const { nonce } = await post("/api/attendance/phone/challenge", { purpose: "FACE" })
        const signature = await device.sign(faceKeyText(nonce, fingerprint))
        return post("/api/attendance/face/key", { nonce, keyFingerprint: fingerprint, signature })
    }
    const answer = await ask()
    if (!answer.deleteTemplates) return answer.key
    await face.deleteTemplates()
    const { nonce } = await post("/api/attendance/phone/challenge", { purpose: "FACE" })
    const signature = await device.sign(faceDeletedText(nonce, fingerprint))
    await post("/api/attendance/face/key/ack", { nonce, keyFingerprint: fingerprint, signature })
    return (await ask()).key
}

/**
 * Sets face verification up on this phone, or does it again when asked to
 * re-verify: the SDK enrols with the wrapping key, and its verification
 * photo goes to a person to approve, signed by the phone with its hash.
 */
export async function enrolFace(device: CheckInDevice, face: FaceVerifier, post: Post) {
    const key = await wrappingKey(device, face, post)
    if (!key) throw new Error("FACE_NOT_AVAILABLE")
    const [{ modelVersion }, { photo }] = [await face.info(), await face.enrol(key)]
    const fingerprint = await keyFingerprint(device)
    const photoSha256 = await sha256OfBase64(photo)
    // After the photo: the number lasts five minutes, and enrolling takes a while.
    const { nonce } = await post("/api/attendance/phone/challenge", { purpose: "FACE" })
    const [signature, attestation] = await Promise.all([
        device.sign(faceText({ nonce, keyFingerprint: fingerprint, photoSha256, modelVersion })),
        // An assertion with the key made at registration, not a new attested key.
        device.attestation(attestedText("FACE", nonce), "CHECK_IN"),
    ])
    return post("/api/attendance/face/photo", { nonce, keyFingerprint: fingerprint, signature, photo, modelVersion, attestation })
}

/**
 * The face check at a check-in: its result, to be signed with the rest, and
 * the frame of a check that never matched. Null with no key (paused, or the
 * templates were just deleted): the server then decides what a check-in
 * without it means.
 */
export async function faceCheck(device: CheckInDevice, face: FaceVerifier, post: Post): Promise<{ face: FaceResult; frame: string | null } | null> {
    const key = await wrappingKey(device, face, post)
    if (!key) return null
    const { modelVersion } = await face.info()
    const r = await face.verify(key)
    const frame = !r.verified && r.frame ? r.frame : null
    return {
        face: { verified: r.verified, score: clamp(r.score), liveness: clamp(r.liveness), modelVersion, attempts: Math.min(10, Math.max(1, Math.round(r.attempts))), frameSha256: frame ? await sha256OfBase64(frame) : null },
        frame,
    }
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/**
 * Brings the waiting templates in line with the decision on their photo:
 * approved, they become the ones matched against; rejected or withdrawn,
 * they go. Nothing while the photo still waits.
 */
export async function settleTemplates(face: FaceVerifier, status: FaceStatus): Promise<"PROMOTED" | "DISCARDED" | null> {
    const action = pendingTemplatesAction(status, await face.info())
    if (action === "PROMOTE") await face.promote()
    if (action === "DISCARD") await face.discardPending()
    return action === "PROMOTE" ? "PROMOTED" : action === "DISCARD" ? "DISCARDED" : null
}
