import { distanceMeters, MAX_ACCURACY_METERS } from "./geo"
import { ipInRanges } from "./ip-ranges"

/**
 * What becomes of a check-in from the app (ATTENDANCE_PLAN.md §9.4, §9.6),
 * decided from what the phone sent and what we know. Pure: no clock, no
 * database, so each rule is tested on its own.
 *
 * - Refused: clear evidence of cheating or a wrong setup; nothing for a
 *   person to judge. Not our phone, the old phone after a new one was asked
 *   for, a location the phone itself says is simulated, attestation failing
 *   once it is required, nowhere this person may check in.
 * - Flagged: something did not check out but could be innocent, so a person
 *   decides. Outside the place's circle, a fix too vague to tell, not on the
 *   office's network where one is set, the app not verified while
 *   attestation is in testing, the face check failed (§9.5).
 * - Held: from a phone still waiting for approval; it counts, or is flagged,
 *   once the phone is approved (§9.3).
 * - Accepted: everything checked out.
 */

export type FlagReason = "OUTSIDE_AREA" | "IMPRECISE_LOCATION" | "OFFICE_IP_MISMATCH" | "ATTESTATION_UNVERIFIED" | "FACE_UNVERIFIED"
export type RefusalReason = "NOT_REGISTERED_PHONE" | "PHONE_SUSPENDED" | "MOCK_LOCATION" | "ATTESTATION_FAILED" | "NO_WORK_LOCATION"

// In geo.ts, which the browser can load (this file's IP check can't be).
export { MAX_ACCURACY_METERS }

export type PlaceToCheck = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; officeIpRanges: string[] }

export type CheckInFacts = {
    /** The phone that signed it, as we have it; null when its key is not one this person registered. */
    phone: { status: "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED" | "WITHDRAWN" } | null
    /** Whether this person has a new phone waiting: from then on only that one checks in (§9.3). */
    newPhoneWaiting: boolean
    fix: { latitude: number; longitude: number; accuracyMeters: number }
    /** The phone's own word that the location was simulated (Android mock provider, iOS isSimulatedBySoftware). */
    mocked: boolean
    attestation: { verified: boolean; required: boolean }
    /**
     * Face verification (§9.5), when it is in use for the person: whether the
     * phone's face check passed. A failed or missing one is flagged, never
     * refused: faces change, and refusing would lock honest people out.
     */
    face?: { required: boolean; verified: boolean }
    places: PlaceToCheck[]
    /** The address the request came from, as the server saw it. */
    ip: string | null
}

export type Verdict =
    | { outcome: "REFUSED"; reason: RefusalReason }
    | { outcome: "ACCEPTED" | "FLAGGED" | "HELD"; reasons: FlagReason[]; place: PlaceToCheck; distanceMeters: number }

export function judgeCheckIn(f: CheckInFacts): Verdict {
    if (!f.phone || (f.phone.status !== "ACTIVE" && f.phone.status !== "PENDING")) return { outcome: "REFUSED", reason: "NOT_REGISTERED_PHONE" }
    if (f.phone.status === "ACTIVE" && f.newPhoneWaiting) return { outcome: "REFUSED", reason: "PHONE_SUSPENDED" }
    if (f.mocked) return { outcome: "REFUSED", reason: "MOCK_LOCATION" }
    if (!f.attestation.verified && f.attestation.required) return { outcome: "REFUSED", reason: "ATTESTATION_FAILED" }
    if (f.places.length === 0) return { outcome: "REFUSED", reason: "NO_WORK_LOCATION" }

    // Checked against the nearest place this person may check in at.
    const measured = f.places.map(place => ({ place, distance: distanceMeters(f.fix, place) })).sort((a, b) => a.distance - b.distance)
    const { place, distance } = measured[0]
    const reasons: FlagReason[] = []
    if (distance > place.radiusMeters) reasons.push("OUTSIDE_AREA")
    if (f.fix.accuracyMeters > Math.max(MAX_ACCURACY_METERS, place.radiusMeters)) reasons.push("IMPRECISE_LOCATION")
    if (place.officeIpRanges.length > 0 && !(f.ip && ipInRanges(f.ip, place.officeIpRanges))) reasons.push("OFFICE_IP_MISMATCH")
    if (!f.attestation.verified) reasons.push("ATTESTATION_UNVERIFIED")
    if (f.face?.required && !f.face.verified) reasons.push("FACE_UNVERIFIED")

    const outcome = f.phone.status === "PENDING" ? "HELD" : reasons.length > 0 ? "FLAGGED" : "ACCEPTED"
    return { outcome, reasons, place, distanceMeters: Math.round(distance) }
}
