import { describe, it, expect } from "vitest"
import { judgeCheckIn, type CheckInFacts } from "./check-in-rules"

/** What becomes of a check-in (ATTENDANCE_PLAN.md §9.4, §9.6), rule by rule. */

const OFFICE = { id: "office", name: "Head office", latitude: 30.0444, longitude: 31.2357, radiusMeters: 100, officeIpRanges: [] as string[] }
const SITE = { id: "site", name: "Site B", latitude: 30.1000, longitude: 31.3000, radiusMeters: 200, officeIpRanges: [] as string[] }
// About 11 m north of the office, and about 333 m north.
const AT_DESK = { latitude: 30.0445, longitude: 31.2357, accuracyMeters: 12 }
const DOWN_THE_ROAD = { latitude: 30.0474, longitude: 31.2357, accuracyMeters: 12 }

const facts = (over: Partial<CheckInFacts> = {}): CheckInFacts => ({
    phone: { status: "ACTIVE" }, newPhoneWaiting: false, fix: AT_DESK, mocked: false,
    attestation: { verified: true, required: true }, places: [OFFICE], ip: "203.0.113.7", ...over,
})

describe("a check-in from the app", () => {
    it("is accepted when everything checks out, against the nearest place the person may use", () => {
        const v = judgeCheckIn(facts({ places: [SITE, OFFICE] }))
        expect(v).toMatchObject({ outcome: "ACCEPTED", reasons: [], place: { id: "office" } })
        expect(v.outcome !== "REFUSED" && v.distanceMeters).toBe(11)
    })

    it("is refused from a phone that isn't the person's, or no longer is", () => {
        expect(judgeCheckIn(facts({ phone: null }))).toEqual({ outcome: "REFUSED", reason: "NOT_REGISTERED_PHONE" })
        for (const status of ["REVOKED", "REJECTED", "WITHDRAWN"] as const) {
            expect(judgeCheckIn(facts({ phone: { status } })), status).toEqual({ outcome: "REFUSED", reason: "NOT_REGISTERED_PHONE" })
        }
    })

    it("is refused from the old phone once a new one has been asked for: the cutover is the moment of asking", () => {
        expect(judgeCheckIn(facts({ newPhoneWaiting: true }))).toEqual({ outcome: "REFUSED", reason: "PHONE_SUSPENDED" })
        // The new phone itself checks in, held until it is decided.
        expect(judgeCheckIn(facts({ phone: { status: "PENDING" }, newPhoneWaiting: true }))).toMatchObject({ outcome: "HELD", reasons: [] })
    })

    it("is refused when the phone says the location was simulated", () => {
        expect(judgeCheckIn(facts({ mocked: true }))).toEqual({ outcome: "REFUSED", reason: "MOCK_LOCATION" })
    })

    it("is refused for an unverified app once attestation is required, and flagged while it is in testing", () => {
        expect(judgeCheckIn(facts({ attestation: { verified: false, required: true } }))).toEqual({ outcome: "REFUSED", reason: "ATTESTATION_FAILED" })
        expect(judgeCheckIn(facts({ attestation: { verified: false, required: false } }))).toMatchObject({ outcome: "FLAGGED", reasons: ["ATTESTATION_UNVERIFIED"] })
    })

    it("is refused when the person has nowhere to check in", () => {
        expect(judgeCheckIn(facts({ places: [] }))).toEqual({ outcome: "REFUSED", reason: "NO_WORK_LOCATION" })
    })

    it("is flagged outside the circle, with how far", () => {
        const v = judgeCheckIn(facts({ fix: DOWN_THE_ROAD }))
        expect(v).toMatchObject({ outcome: "FLAGGED", reasons: ["OUTSIDE_AREA"] })
        expect(v.outcome !== "REFUSED" && v.distanceMeters).toBe(334)
    })

    it("is flagged when the fix is too vague to say: wider than 50 m, or than the place's own circle", () => {
        expect(judgeCheckIn(facts({ fix: { ...AT_DESK, accuracyMeters: 120 } }))).toMatchObject({ outcome: "FLAGGED", reasons: ["IMPRECISE_LOCATION"] })
        expect(judgeCheckIn(facts({ fix: { ...AT_DESK, accuracyMeters: 90 } }))).toMatchObject({ outcome: "ACCEPTED" })
        expect(judgeCheckIn(facts({ fix: { ...AT_DESK, accuracyMeters: 60 }, places: [{ ...OFFICE, radiusMeters: 40 }] }))).toMatchObject({ outcome: "FLAGGED", reasons: ["IMPRECISE_LOCATION"] })
    })

    it("is flagged off the office's network where the place has office IPs, and not checked where it has none", () => {
        const withIps = { ...OFFICE, officeIpRanges: ["198.51.100.0/24"] }
        expect(judgeCheckIn(facts({ places: [withIps], ip: "198.51.100.40" }))).toMatchObject({ outcome: "ACCEPTED" })
        expect(judgeCheckIn(facts({ places: [withIps], ip: "203.0.113.7" }))).toMatchObject({ outcome: "FLAGGED", reasons: ["OFFICE_IP_MISMATCH"] })
        expect(judgeCheckIn(facts({ places: [withIps], ip: null }))).toMatchObject({ outcome: "FLAGGED", reasons: ["OFFICE_IP_MISMATCH"] })
        expect(judgeCheckIn(facts({ ip: null }))).toMatchObject({ outcome: "ACCEPTED" })
    })

    it("is flagged when the face check failed, or when the phone in use has no approved face to check against", () => {
        expect(judgeCheckIn(facts({ face: { required: true, verified: true } }))).toMatchObject({ outcome: "ACCEPTED" })
        expect(judgeCheckIn(facts({ face: { required: true, verified: false } }))).toMatchObject({ outcome: "FLAGGED", reasons: ["FACE_UNVERIFIED"] })
        // A new phone: nothing to match against, which isn't a failed match.
        expect(judgeCheckIn(facts({ face: { required: false, verified: false, notSetUp: true } }))).toMatchObject({ outcome: "FLAGGED", reasons: ["FACE_NOT_SET_UP"] })
        expect(judgeCheckIn(facts({ face: { required: false, verified: false } }))).toMatchObject({ outcome: "ACCEPTED" })
    })

    it("names every reason when several things are off, and holds a new phone's check-in with them for its approval", () => {
        const all = facts({ fix: { ...DOWN_THE_ROAD, accuracyMeters: 500 }, places: [{ ...OFFICE, officeIpRanges: ["198.51.100.0/24"] }], attestation: { verified: false, required: false } })
        expect(judgeCheckIn(all)).toMatchObject({ outcome: "FLAGGED", reasons: ["OUTSIDE_AREA", "IMPRECISE_LOCATION", "OFFICE_IP_MISMATCH", "ATTESTATION_UNVERIFIED"] })
        expect(judgeCheckIn({ ...all, phone: { status: "PENDING" } })).toMatchObject({ outcome: "HELD", reasons: ["OUTSIDE_AREA", "IMPRECISE_LOCATION", "OFFICE_IP_MISMATCH", "ATTESTATION_UNVERIFIED"] })
    })
})
