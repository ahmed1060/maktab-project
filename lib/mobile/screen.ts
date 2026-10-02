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
