import { describe, it, expect } from "vitest"
import { answerKey, thisPhone, faceStep, type FaceStatus } from "./screen"

/** What the check-in screen tells the person (lib/mobile/screen.ts). */

const answer = (outcome: "ACCEPTED" | "FLAGGED" | "HELD", reasons: string[] = []) =>
    ({ outcome, reasons, place: { id: "p", name: "Head office" }, distanceMeters: 11, at: "2026-09-27T09:40:00", late: null })

describe("the message for a check-in", () => {
    it("says a held check-in with reasons waits for a review too, not only for the phone", () => {
        expect(answerKey(answer("HELD", ["ATTESTATION_UNVERIFIED"]))).toBe("ci_held_flagged")
    })

    it("says a clean held check-in counts once the phone is approved, and names the others plainly", () => {
        expect(answerKey(answer("HELD"))).toBe("ci_held")
        expect(answerKey(answer("ACCEPTED"))).toBe("ci_accepted")
        expect(answerKey(answer("FLAGGED", ["OUTSIDE_AREA"]))).toBe("ci_flagged")
    })
})

describe("which phone this is", () => {
    const active = { keyFingerprint: "a".repeat(64), model: "Pixel 8" }
    const pending = { keyFingerprint: "b".repeat(64), model: "Pixel 9" }

    it("doesn't wait forever when the phone's key can't be read: no key, the failure said, the way to register again", () => {
        expect(thisPhone({ active, pending: null }, { fingerprint: undefined, failed: true })).toEqual({ mine: null, other: active, keyFailed: true })
    })

    it("waits while either is still being found out", () => {
        expect(thisPhone(undefined, { fingerprint: active.keyFingerprint, failed: false })).toBeUndefined()
        expect(thisPhone({ active, pending: null }, { fingerprint: undefined, failed: false })).toBeUndefined()
    })

    it("knows the phone in use, the one waiting, and one that is neither", () => {
        expect(thisPhone({ active, pending }, { fingerprint: active.keyFingerprint, failed: false })).toMatchObject({ mine: "ACTIVE", other: null })
        expect(thisPhone({ active, pending }, { fingerprint: pending.keyFingerprint, failed: false })).toMatchObject({ mine: "PENDING", other: null })
        expect(thisPhone({ active, pending }, { fingerprint: null, failed: false })).toMatchObject({ mine: null, other: pending })
        expect(thisPhone({ active: null, pending: null }, { fingerprint: null, failed: false })).toEqual({ mine: null, other: null, keyFailed: false })
    })
})

describe("faceStep", () => {
    const status = (over: Partial<FaceStatus> = {}): FaceStatus => ({
        active: false, required: true, consent: { acceptedAt: "2026-10-03T08:00:00Z" }, consentVersion: "v", phone: { faceStatus: "NONE" }, pendingReview: false, reverifyDue: false, ...over,
    })
    const here = { phoneActive: true, verifier: true }

    it("asks nothing when face verification isn't asked of the person, or is paused", () => {
        expect(faceStep(undefined, here)).toBeNull()
        expect(faceStep(status({ required: false }), here)).toBeNull()
    })

    it("asks for consent first, even before the phone is approved", () => {
        expect(faceStep(status({ consent: null }), { phoneActive: false, verifier: false })).toBe("CONSENT")
    })

    it("sets up only from the phone in use, and only with an app that has the face SDK", () => {
        expect(faceStep(status(), { phoneActive: false, verifier: true })).toBeNull()
        expect(faceStep(status(), { phoneActive: true, verifier: false })).toBe("NEEDS_APP")
        expect(faceStep(status(), here)).toBe("ENROL")
        expect(faceStep(status({ phone: { faceStatus: "REJECTED" } }), here)).toBe("REJECTED")
    })

    it("waits for the photo's approval, then is in use, or asks to verify again", () => {
        expect(faceStep(status({ pendingReview: true, phone: { faceStatus: "PENDING" } }), here)).toBe("WAITING")
        expect(faceStep(status({ active: true, phone: { faceStatus: "APPROVED" } }), here)).toBe("READY")
        expect(faceStep(status({ active: true, phone: { faceStatus: "APPROVED" }, reverifyDue: true }), here)).toBe("REVERIFY")
        // Re-verification sent: waiting for it outranks asking again.
        expect(faceStep(status({ active: true, phone: { faceStatus: "APPROVED" }, reverifyDue: true, pendingReview: true }), here)).toBe("WAITING")
    })
})
