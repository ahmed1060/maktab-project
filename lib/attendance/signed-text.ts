/**
 * The exact texts a phone signs (ATTENDANCE_PLAN.md §9.2), in one place the
 * server and the check-in screen both read, so the two can never write them
 * differently. No imports: it runs in the browser as well as on the server.
 */

export type SignedPurpose = "REGISTER" | "CHECK_IN" | "FACE"

/**
 * What a phone signs: the purpose, the one-time number the server gave it,
 * and the details of what it is doing, one per line. Fixed and unambiguous,
 * so a signature for one thing can never be passed off as another.
 */
export function signedText(purpose: SignedPurpose, nonce: string, details: readonly (string | number)[]): string {
    return ["nizmo-attendance/v1", purpose, nonce, ...details.map(String)].join("\n")
}

/**
 * The exact text a phone signs for a check-in: the number, which key, the fix
 * and whether it was simulated, the direction if the person chose one.
 * Numbers as JavaScript writes them (String(n)).
 */
export function checkInText(input: {
    nonce: string; keyFingerprint: string; latitude: number; longitude: number; accuracyMeters: number; mocked: boolean; direction?: "IN" | "OUT" | null
    face?: FaceResult | null
}): string {
    const base = [input.keyFingerprint, input.latitude, input.longitude, input.accuracyMeters, input.mocked ? 1 : 0, input.direction ?? ""]
    // The face check's result, when there was one (§9.5), signed with the rest so
    // a modified app can't simply claim "verified". Absent, the text is as before.
    const face = input.face
        ? [face0(input.face.verified), input.face.score, input.face.liveness, input.face.modelVersion, input.face.attempts, input.face.frameSha256 ?? ""]
        : []
    return signedText("CHECK_IN", input.nonce, [...base, ...face])
}

const face0 = (verified: boolean) => (verified ? "face:1" : "face:0")

/**
 * What the phone's face check found at a check-in (§9.5): the result only,
 * never the face. When it failed, the hash of the last frame, which is sent
 * with the check-in for a person to look at (§13.8).
 */
export type FaceResult = {
    verified: boolean
    /** Match score, 0..1. */
    score: number
    /** Liveness score, 0..1. */
    liveness: number
    modelVersion: string
    /** Tries before this result, 1..3. */
    attempts: number
    /** sha256 hex of the frame sent with a failed check, else null. */
    frameSha256?: string | null
}

/**
 * What a phone's proof of our genuine app covers (§9.4): the one-time number
 * and what it was given for. The phone hashes this text (sha256): that is
 * the Play Integrity nonce on Android, and App Attest's client data hash on
 * iOS.
 */
export function attestedText(purpose: SignedPurpose, nonce: string): string {
    return `nizmo-attest|${purpose}|${nonce}`
}
