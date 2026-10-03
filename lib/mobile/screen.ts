import type { CheckInAnswer } from "./check-in-flow"

/**
 * What the check-in screen says, decided apart from how it looks, so it can
 * be tested without a browser.
 */

/**
 * Which message an answer gets. A held check-in with reasons is flagged when
 * its phone is approved (AttendancePhoneService.decide), so it waits for a
 * review as well; saying approval alone makes it count would be untrue, and
 * while attestation is in testing that is every held check-in (review on #24).
 */
export function answerKey(answer: Exclude<CheckInAnswer, { outcome: "REFUSED" }>) {
    if (answer.outcome === "ACCEPTED") return "ci_accepted" as const
    if (answer.outcome === "FLAGGED") return "ci_flagged" as const
    return answer.reasons.length > 0 ? "ci_held_flagged" as const : "ci_held" as const
}

type Phone = { keyFingerprint: string }

/**
 * Which of the person's phones this one is, once both are known: the one in
 * use, the one waiting, or neither (then it can be registered, or replace
 * the other). Undefined while still finding out. A phone whose key can't be
 * read counts as having none, with the failure said, so the person can
 * register it again rather than wait on a spinner forever (review on #24).
 */
export function thisPhone<P extends Phone>(
    phones: { active: P | null; pending: P | null } | undefined,
    key: { fingerprint: string | null | undefined; failed: boolean },
): { mine: "ACTIVE" | "PENDING" | null; other: P | null; keyFailed: boolean } | undefined {
    if (!phones || (key.fingerprint === undefined && !key.failed)) return undefined
    const fingerprint = key.failed ? null : key.fingerprint
    const mine = fingerprint && phones.active?.keyFingerprint === fingerprint ? "ACTIVE"
        : fingerprint && phones.pending?.keyFingerprint === fingerprint ? "PENDING" : null
    return { mine, other: mine ? null : phones.pending ?? phones.active, keyFailed: key.failed }
}

/** Where face verification stands for oneself, as GET /api/attendance/face gives it. */
export type FaceStatus = {
    active: boolean
    required: boolean
    consent: { acceptedAt: string } | null
    consentVersion: string
    phone: { faceStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED" } | null
    pendingReview: boolean
    reverifyDue: boolean
}

/**
 * What the check-in screen asks of the person about face verification
 * (§9.5), one step at a time: nothing when it isn't asked of them; their
 * consent first; then, from their phone in use, setting it up, waiting for
 * the photo's approval, or doing it again. An app without the face SDK can't
 * set it up, and says so; once it is in use there, check-ins without a face
 * check wait for a review, which the person should know.
 */
export function faceStep(status: FaceStatus | undefined, here: { phoneActive: boolean; verifier: boolean }):
    null | "IDLE" | "CONSENT" | "WAITING" | "NEEDS_APP" | "ENROL" | "REJECTED" | "REVERIFY" | "READY" {
    if (!status) return null
    // Not in use for them now (paused, no longer offered or asked), but consent
    // given stays withdrawable in one tap (review on #27).
    if (!status.required) return status.consent ? "IDLE" : null
    if (!status.consent) return "CONSENT"
    if (!here.phoneActive) return null
    if (status.pendingReview) return "WAITING"
    if (!here.verifier) return "NEEDS_APP"
    const face = status.phone?.faceStatus
    if (face === "APPROVED") return status.reverifyDue ? "REVERIFY" : "READY"
    return face === "REJECTED" ? "REJECTED" : "ENROL"
}

/**
 * Whether this phone should ask the server about face templates it holds
 * while face verification isn't in use for the person: they may have been
 * told to go (no longer asked, purged) with nothing else ever asking
 * (review on #27). Paused keeps them; the server says which.
 */
export function shouldReconcileTemplates(status: FaceStatus | undefined, here: { phoneActive: boolean; enrolled: boolean }): boolean {
    if (!status || !here.phoneActive || !here.enrolled) return false
    return !(status.required && status.consent)
}

/** Whether the next check-in starts with re-verification: asked for or due, and none sent yet (§9.5). */
export function reverifyFirst(status: FaceStatus | undefined): boolean {
    return !!status?.active && status.reverifyDue && !status.pendingReview
}

/**
 * What becomes of templates waiting on this phone once their photo is
 * decided (§9.5): approved (the phone's face status is APPROVED and nothing
 * waits), they replace the approved ones; otherwise they go. Nothing while
 * the photo waits, or with nothing waiting.
 */
export function pendingTemplatesAction(status: FaceStatus | undefined, info: { pending: boolean }): "PROMOTE" | "DISCARD" | null {
    if (!status || !info.pending || status.pendingReview) return null
    // Approval leaves the phone APPROVED; rejection leaves it REJECTED, and withdrawal NONE.
    return status.phone?.faceStatus === "APPROVED" ? "PROMOTE" : "DISCARD"
}
