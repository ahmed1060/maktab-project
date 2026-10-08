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
    /** modelVersion: the face model that made the approved templates; null when it was never recorded. */
    phone: { faceStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED"; modelVersion?: string | null } | null
    pendingReview: boolean
    reverifyDue: boolean
    /** The person's latest verification photo and where it stands. */
    lastReview?: { id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" } | null
    /**
     * When the app asked for this, by its own clock (the page's fetcher adds
     * it): an answer asked for before a photo went can't say it never
     * arrived (review on #49).
     */
    askedAt?: number
}

/**
 * What the check-in screen asks of the person about face verification
 * (§9.5), one step at a time: nothing when it isn't asked of them; their
 * consent first; then, from their phone in use, setting it up, waiting for
 * the photo's approval, or doing it again. An app without the face SDK can't
 * set it up, and says so; once it is in use there, check-ins without a face
 * check wait for a review, which the person should know.
 */
export function faceStep(status: FaceStatus | undefined, here: { phoneActive: boolean; verifier: boolean; modelVersion?: string | null }):
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
    if (face === "APPROVED") return status.reverifyDue || modelChanged(status, here.modelVersion) ? "REVERIFY" : "READY"
    return face === "REJECTED" ? "REJECTED" : "ENROL"
}

/**
 * Whether the approved templates were made by another face model than the
 * app's now: they can't be matched against (a new model reads faces
 * differently), so the face is set up again, as a re-verification, and
 * check-ins carry on meanwhile without a face check, for a review. Not known
 * until the app has said its model.
 */
export function modelChanged(status: FaceStatus | undefined, modelVersion: string | null | undefined): boolean {
    const phone = status?.phone
    if (!status?.active || !modelVersion || phone?.faceStatus !== "APPROVED" || phone.modelVersion === undefined) return false
    return phone.modelVersion !== modelVersion
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

type Loading = { data: unknown; error: unknown }

/**
 * Whether Check in may start: once the person's face status is known, and,
 * with a face check in this app, which face model it has; or once either
 * failed to load, so a failure never stops anyone checking in. Tapped
 * sooner, nothing said to set the face up or check it, and the check-in went
 * without either (review on #49).
 */
export function faceReady(status: Loading, model?: Loading): boolean {
    const known = (l: Loading) => l.data !== undefined || !!l.error
    return known(status) && (!model || known(model))
}

/**
 * What the face card adds after its text: on an app that can't do the face
 * check, check-ins go without one and wait for a review, whether or not a
 * face was ever approved on this phone (no approved face on it, or no face
 * check). It said so only when a face was in use (review on #49). The other
 * steps' own texts say it already.
 */
export function faceCardNote(step: ReturnType<typeof faceStep>): "face_ci_needs_app_flagged" | null {
    return step === "NEEDS_APP" ? "face_ci_needs_app_flagged" : null
}

/**
 * Whether the next check-in starts by setting the face up on this phone: asked
 * of the person, who consented, with nothing on this phone to match against
 * and no photo waiting (a new phone, or its photo rejected). Otherwise the
 * check-in went out flagged with no camera ever shown, and the person was left
 * to find the set-up below the buttons (§9.3).
 */
export function setUpFirst(status: FaceStatus | undefined, here: { phoneActive: boolean; verifier: boolean }): boolean {
    const step = faceStep(status, here)
    return step === "ENROL" || step === "REJECTED"
}

/**
 * Whether the next check-in starts with re-verification: asked for, due, or a
 * new face model, and none sent yet (§9.5). Only from the phone in use, as
 * setting it up: the status is that phone's, and a replacement waiting for
 * approval can't fetch a face key, so it ended in an error before every
 * check-in (review on #27).
 */
export function reverifyFirst(status: FaceStatus | undefined, here: { phoneActive: boolean; modelVersion?: string | null }): boolean {
    return here.phoneActive && !!status?.active && (status.reverifyDue || modelChanged(status, here.modelVersion)) && !status.pendingReview
}

/**
 * What becomes of templates waiting on this phone (§9.5). They are promoted
 * only once the very review they were sent with is approved: the app
 * records the id that review is stored under before the photo goes
 * (faceReviewId), so a reply lost on the way still finds it (review on #27).
 * Waiting templates with no such review were never sent (the upload failed,
 * or the app stopped first), so nobody saw that face: they go (review on
 * #28). Nothing while their photo waits.
 */
export function pendingTemplatesAction(status: FaceStatus | undefined, info: { pending: boolean }, sent: SentWith | null): "PROMOTE" | "DISCARD" | null {
    if (!status || !info.pending) return null
    const last = status.lastReview
    if (sent && last?.id === sent.id) {
        if (last.status === "PENDING") return null
        return last.status === "APPROVED" && status.phone?.faceStatus === "APPROVED" ? "PROMOTE" : "DISCARD"
    }
    if (!sent) return "DISCARD"
    // Sent, and the answer doesn't show it: it may have been asked for before the photo went, or while the photo
    // was still being stored. Dropped then, an approval a moment later found nothing to promote (review on #49).
    // Only an answer asked for once the photo can no longer be stored settles that it never was.
    if (status.pendingReview || (status.askedAt ?? -Infinity) < sent.at + SENT_SETTLES_MS) return null
    return "DISCARD"
}

/** Which review waiting templates were sent with, and when the app recorded it, by its own clock. */
export type SentWith = { id: string; at: number }

/**
 * How long after the photo went it can still be stored: its one-time number
 * lasts five minutes (CHALLENGE_TTL_MS), the save up to thirty seconds.
 */
export const SENT_SETTLES_MS = 6 * 60_000
