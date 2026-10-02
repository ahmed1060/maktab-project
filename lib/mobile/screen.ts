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
