import { describe, it, expect } from "vitest"
import { answerKey, thisPhone } from "./screen"

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
