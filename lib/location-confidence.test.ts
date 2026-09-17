import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { extractAccuracy, locationVerdict } from "./location"
import { stripComments } from "./strip-comments"

/**
 * Location verification decides whether somebody was where they said. A verdict
 * of WRONG can justify a penalty, a penalty becomes a salary adjustment, and a
 * salary adjustment becomes a line on a payslip — so an imprecise GPS reading
 * has a path all the way to somebody's pay.
 *
 * The app used to force a verdict from every reading, because it threw away the
 * one number that says how much to trust one. `accuracy` is the radius the
 * browser is 68% confident the person is inside: five to twenty metres from a
 * satellite fix, twenty to a hundred over Wi-Fi, and several kilometres from a
 * network-derived position indoors. All three looked identical once it was
 * dropped.
 */

// Two points ~111 m apart: a tenth of a degree of latitude is ~11.1 km, so a
// thousandth is ~111 m. Kept as a derived constant rather than a magic pair.
const TARGET = { lat: 30.0, lng: 31.0 }
const M111 = { lat: 30.001, lng: 31.0 }

describe("a reading is judged as a circle, not a point", () => {
    it("is CORRECT only when the whole circle is inside", () => {
        // 111 m away, give or take 5 — comfortably within 200.
        expect(locationVerdict(TARGET, M111, 200, 5)).toBe("CORRECT")
    })

    it("is WRONG only when the whole circle is outside", () => {
        // 111 m away, give or take 5, against a 50 m radius.
        expect(locationVerdict(TARGET, M111, 50, 5)).toBe("WRONG")
    })

    it("declines to decide when the circle straddles the boundary", () => {
        // This is the case that used to be answered anyway, and answered
        // confidently, in whichever direction the centre happened to fall.
        expect(locationVerdict(TARGET, M111, 100, 60)).toBe("UNVERIFIED")
        expect(locationVerdict(TARGET, M111, 120, 60)).toBe("UNVERIFIED")
    })

    it("does not call a kilometre-wide reading wrong", () => {
        // A network-derived fix indoors. The person may well be standing on the
        // target; the reading simply cannot say. Marking this WRONG is the
        // failure the third state exists to remove.
        expect(locationVerdict(TARGET, M111, 70, 3000)).toBe("UNVERIFIED")
    })

    it("does not call a kilometre-wide reading correct either", () => {
        // The mirror image, and the quieter of the two: a huge circle happening
        // to cover the target says nothing about where the person is.
        const farAway = { lat: 30.05, lng: 31.0 }
        expect(locationVerdict(TARGET, farAway, 5000, 3000)).toBe("UNVERIFIED")
    })

    it("treats a reading with no recorded accuracy as exact", () => {
        // Every position taken before accuracy was kept has none. Without this
        // they would all become UNVERIFIED, which is why callers must also not
        // re-decide them — see the guard below.
        expect(locationVerdict(TARGET, M111, 200, null)).toBe("CORRECT")
        expect(locationVerdict(TARGET, M111, 50, null)).toBe("WRONG")
    })
})

describe("accuracy is read back from what was stored", () => {
    it("reads the number the browser gave", () => {
        expect(extractAccuracy('{"latitude":30,"longitude":31,"accuracy":12.5}')).toBe(12.5)
    })

    it("returns null for a position recorded before accuracy was kept", () => {
        expect(extractAccuracy('{"latitude":30,"longitude":31,"address":"x"}')).toBeNull()
    })

    it("rejects values that are not a confident reading", () => {
        // Zero is not perfect precision, it is a broken reading — and treating
        // it as exact would make the worst readings the most trusted.
        expect(extractAccuracy('{"accuracy":0}')).toBeNull()
        expect(extractAccuracy('{"accuracy":-5}')).toBeNull()
        expect(extractAccuracy('{"accuracy":"nonsense"}')).toBeNull()
    })

    it("survives the formats this column actually holds", () => {
        expect(extractAccuracy("30.0444,31.2357")).toBeNull()
        expect(extractAccuracy(null)).toBeNull()
        expect(extractAccuracy("{not json")).toBeNull()
    })
})

describe("the capture keeps what the verdict depends on", () => {
    const client = stripComments(
        readFileSync("app/(dashboard)/dashboard/tasks/[id]/client.tsx", "utf8"),
    )

    it("stores the accuracy alongside the position", () => {
        // Dropping this one field is the whole original bug.
        expect(client, "accuracy is not read off the fix").toContain("accuracy } = pos.coords")
        expect(client, "accuracy is not stored with the position").toContain("accuracy, address: locationName")
    })

    it("takes the best fix in a window, not the first", () => {
        // Accuracy improves as the receiver locks. getCurrentPosition with a
        // ten second timeout usually returned before the satellite fix arrived,
        // so the setting asking for precision and the one denying it time were
        // on the same line.
        expect(client, "capture is back to a single shot").toContain("navigator.geolocation.watchPosition")
        expect(client).toContain("pos.coords.accuracy < best.coords.accuracy")
    })

    it("says which failure happened", () => {
        // Every failure used to render as "Failed to get location". Somebody
        // who blocked the permission needs entirely different advice from
        // somebody standing indoors waiting for a lock.
        expect(client).toContain("err.PERMISSION_DENIED")
        expect(client).toContain("err.POSITION_UNAVAILABLE")
        expect(client, "the untranslated catch-all is back").not.toContain("'Failed to get location'")
    })
})

describe("historical verdicts are left alone", () => {
    const service = stripComments(readFileSync("lib/services/task.service.ts", "utf8"))

    it("does not re-open a decided reading that has no accuracy", () => {
        // The re-verification loop runs over anything autoVerified whenever a
        // task's target location is edited. Without this, every verdict ever
        // recorded would fall into UNVERIFIED at once — re-opening decisions
        // already acted on, and filling the queue with cases no person can
        // resolve, because the reading that would settle them no longer exists.
        expect(service).toContain("if (accuracy === null && c.verificationStatus) return c")
    })

    it("routes both verification sites through the same rule", () => {
        // There are two: one when a task's target moves, one when a position is
        // submitted. They disagreeing is how a reading gets two verdicts.
        expect(service.match(/locationVerdict\(/g) ?? []).toHaveLength(2)
        expect(service, "a site is still comparing distances by hand").not.toContain("calculateDistance(")
    })
})
