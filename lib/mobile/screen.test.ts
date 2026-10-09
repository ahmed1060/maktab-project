import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { answerKey, checksFace, thisPhone, faceCardNote, faceModelNeeded, faceReady, faceStep, modelChanged, pendingTemplatesAction, reverifyFirst, setUpFirst, shouldReconcileTemplates, withinTime, FACE_PLUGIN_WAIT_MS, SENT_SETTLES_MS, type FaceStatus } from "./screen"
import { readSent } from "./face"

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

    it("asks nothing when face verification isn't asked of the person, but keeps consent withdrawable (review on #27)", () => {
        expect(faceStep(undefined, here)).toBeNull()
        expect(faceStep(status({ required: false, consent: null }), here)).toBeNull()
        // Paused, or no longer offered or asked: consent given can still be withdrawn in one tap.
        expect(faceStep(status({ required: false }), { phoneActive: false, verifier: false })).toBe("IDLE")
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

    it("sets the face up again when the app's face model isn't the one that made the approved templates", () => {
        const approved = (modelVersion: string | null) => status({ active: true, phone: { faceStatus: "APPROVED", modelVersion } })
        const v2 = { ...here, modelVersion: "prototype-insightface-r50-v2" }
        expect(faceStep(approved("prototype-dlib-resnet-v1"), v2)).toBe("REVERIFY")
        expect(faceStep(approved(null), v2)).toBe("REVERIFY")
        expect(faceStep(approved("prototype-insightface-r50-v2"), v2)).toBe("READY")
        // Until the app has said its model, nothing changes.
        expect(faceStep(approved("prototype-dlib-resnet-v1"), here)).toBe("READY")
        // And once the new photo is sent, it waits for that.
        expect(faceStep(status({ active: true, pendingReview: true, phone: { faceStatus: "APPROVED", modelVersion: "prototype-dlib-resnet-v1" } }), v2)).toBe("WAITING")
    })
})

describe("checking in before the face status is known", () => {
    it("waits for the face status, and the app's face model where it has a face check (review on #49)", () => {
        const loading = { data: undefined, error: undefined }
        const loaded = { data: { success: true }, error: undefined }
        expect(faceReady(loading)).toBe(false)
        expect(faceReady(loaded)).toBe(true)
        expect(faceReady(loaded, loading)).toBe(false)
        expect(faceReady(loaded, { data: "prototype-insightface-r50-v2", error: undefined })).toBe(true)
    })

    it("never waits on a failure: the check-in goes, and the server decides", () => {
        const failed = { data: undefined, error: new Error("offline") }
        expect(faceReady(failed)).toBe(true)
        expect(faceReady({ data: { success: true }, error: undefined }, failed)).toBe(true)
    })
})

describe("the face card's note", () => {
    it("says check-ins wait for a review on an app without the face check, whether or not a face was approved (review on #49)", () => {
        expect(faceCardNote("NEEDS_APP")).toBe("face_ci_needs_app_flagged")
        // The others' texts say it already, or there is nothing to say.
        for (const step of ["ENROL", "REJECTED", "WAITING", "READY", "REVERIFY", "CONSENT", "IDLE", null] as const) expect(faceCardNote(step)).toBeNull()
    })
})

describe("setting the face up when checking in", () => {
    const status = (over: Partial<FaceStatus> = {}): FaceStatus => ({
        active: false, required: true, consent: { acceptedAt: "2026-10-03T08:00:00Z" }, consentVersion: "v", phone: { faceStatus: "NONE" }, pendingReview: false, reverifyDue: false, ...over,
    })
    const here = { phoneActive: true, verifier: true }

    it("starts the check-in with the set-up on a phone with no face set up, or one rejected (§9.3)", () => {
        expect(setUpFirst(status(), here)).toBe(true)
        expect(setUpFirst(status({ phone: { faceStatus: "REJECTED" } }), here)).toBe(true)
    })

    it("doesn't once a photo waits, the face is in use, or the set-up can't happen here", () => {
        expect(setUpFirst(status({ pendingReview: true, phone: { faceStatus: "PENDING" } }), here)).toBe(false)
        expect(setUpFirst(status({ active: true, phone: { faceStatus: "APPROVED" } }), here)).toBe(false)
        expect(setUpFirst(status({ consent: null }), here)).toBe(false)
        expect(setUpFirst(status({ required: false }), here)).toBe(false)
        expect(setUpFirst(status(), { phoneActive: false, verifier: true })).toBe(false)
        expect(setUpFirst(status(), { phoneActive: true, verifier: false })).toBe(false)
        expect(setUpFirst(undefined, here)).toBe(false)
    })
})

describe("face templates and re-verification on this phone", () => {
    const status = (over: Partial<FaceStatus> = {}): FaceStatus => ({
        active: true, required: true, consent: { acceptedAt: "2026-10-03T08:00:00Z" }, consentVersion: "v", phone: { faceStatus: "APPROVED" }, pendingReview: false, reverifyDue: false, ...over,
    })

    it("asks about templates it holds once face verification isn't in use for the person (review on #27)", () => {
        const here = { phoneActive: true, enrolled: true }
        expect(shouldReconcileTemplates(status(), here)).toBe(false)
        expect(shouldReconcileTemplates(status({ active: false, phone: { faceStatus: "PENDING" }, pendingReview: true }), here)).toBe(false)
        expect(shouldReconcileTemplates(status({ active: false, required: false }), here)).toBe(true)
        expect(shouldReconcileTemplates(status({ active: false, consent: null }), here)).toBe(true)
        expect(shouldReconcileTemplates(status({ active: false, required: false }), { phoneActive: true, enrolled: false })).toBe(false)
        expect(shouldReconcileTemplates(status({ active: false, required: false }), { phoneActive: false, enrolled: true })).toBe(false)
    })

    it("starts the next check-in with re-verification when it is due and none is waiting", () => {
        const here = { phoneActive: true }
        expect(reverifyFirst(status(), here)).toBe(false)
        expect(reverifyFirst(status({ reverifyDue: true }), here)).toBe(true)
        expect(reverifyFirst(status({ reverifyDue: true, pendingReview: true }), here)).toBe(false)
        expect(reverifyFirst(status({ reverifyDue: true, active: false }), here)).toBe(false)
    })

    it("doesn't from a replacement phone waiting for approval, whose status is the old phone's (review on #27)", () => {
        expect(reverifyFirst(status({ reverifyDue: true }), { phoneActive: false })).toBe(false)
        const old = status({ phone: { faceStatus: "APPROVED", modelVersion: "prototype-dlib-resnet-v1" } })
        expect(reverifyFirst(old, { phoneActive: false, modelVersion: "prototype-insightface-r50-v2" })).toBe(false)
    })

    it("checks the face only from the phone in use, with its approved templates from this face model (review on #49)", () => {
        const here = { phoneActive: true, modelVersion: "prototype-insightface-r50-v2" }
        expect(checksFace(status(), here)).toBe(true)
        // A replacement waiting for approval: the status is the old phone's, approved, and this one has no face key.
        expect(checksFace(status(), { ...here, phoneActive: false })).toBe(false)
        expect(checksFace(status({ active: false }), here)).toBe(false)
        expect(checksFace(status({ phone: { faceStatus: "APPROVED", modelVersion: "prototype-dlib-resnet-v1" } }), here)).toBe(false)
        expect(checksFace(undefined, here)).toBe(false)
        const page = readFileSync("app/(dashboard)/dashboard/check-in/page.tsx", "utf8")
        expect(page).toContain("checkIn(device!, post, direction, checksFace(faceStatus, { phoneActive, modelVersion: faceModel }) ? face : null)")
        expect(page).toContain("const working = face && checksFace(faceStatus, { phoneActive, modelVersion: faceModel }) ? t('face_ci_checking')")
    })

    it("starts the next check-in by setting the face up again with a new face model, and leaves the old templates out of it", () => {
        const old = status({ phone: { faceStatus: "APPROVED", modelVersion: "prototype-dlib-resnet-v1" } })
        expect(modelChanged(old, "prototype-insightface-r50-v2")).toBe(true)
        expect(reverifyFirst(old, { phoneActive: true, modelVersion: "prototype-insightface-r50-v2" })).toBe(true)
        expect(reverifyFirst({ ...old, pendingReview: true }, { phoneActive: true, modelVersion: "prototype-insightface-r50-v2" })).toBe(false)
        expect(modelChanged(old, "prototype-dlib-resnet-v1")).toBe(false)
        // An older server that doesn't say: no change assumed.
        expect(modelChanged(status(), "prototype-insightface-r50-v2")).toBe(false)
    })
})

describe("templates waiting on their photo (§9.5)", () => {
    const status = (over: Partial<FaceStatus> = {}): FaceStatus => ({
        active: true, required: true, consent: { acceptedAt: "2026-10-03T08:00:00Z" }, consentVersion: "v", phone: { faceStatus: "APPROVED" },
        pendingReview: false, reverifyDue: false, lastReview: { id: "r2", status: "APPROVED" }, askedAt: SENT_SETTLES_MS, ...over,
    })
    const waiting = { pending: true }
    // Recorded before the photo went; the answers below asked for long after.
    const r2 = { id: "r2", at: 0 }

    it("promotes them only once the review they were sent with is approved", () => {
        expect(pendingTemplatesAction(status({ pendingReview: true, lastReview: { id: "r2", status: "PENDING" } }), waiting, r2)).toBeNull()
        expect(pendingTemplatesAction(status(), { pending: false }, r2)).toBeNull()
        expect(pendingTemplatesAction(status(), waiting, r2)).toBe("PROMOTE")
        // Approved while paused still promotes: the decision is the reviewer's.
        expect(pendingTemplatesAction(status({ required: false, active: false }), waiting, r2)).toBe("PROMOTE")
    })

    it("drops them when their review was rejected or withdrawn, or when they never reached a reviewer (review on #28)", () => {
        expect(pendingTemplatesAction(status({ phone: { faceStatus: "REJECTED" }, lastReview: { id: "r2", status: "REJECTED" } }), waiting, r2)).toBe("DISCARD")
        expect(pendingTemplatesAction(status({ lastReview: { id: "r2", status: "WITHDRAWN" } }), waiting, r2)).toBe("DISCARD")
        // The upload failed, or the app stopped first: the phone still looks approved, from an older review.
        expect(pendingTemplatesAction(status({ lastReview: { id: "r1", status: "APPROVED" } }), waiting, null)).toBe("DISCARD")
        expect(pendingTemplatesAction(status({ lastReview: { id: "r1", status: "APPROVED" } }), waiting, r2)).toBe("DISCARD")
    })

    it("keeps them when the answer doesn't show their photo but may predate it, or the photo may still be being stored (review on #49)", () => {
        const sentAt = 1_000_000
        const sent = { id: "r3", at: sentAt }
        const older = { lastReview: { id: "r2", status: "APPROVED" as const } }
        // Asked for before the photo went: the page's answer from then.
        expect(pendingTemplatesAction(status({ ...older, askedAt: sentAt - 1 }), waiting, sent)).toBeNull()
        // Asked for while it could still be stored.
        expect(pendingTemplatesAction(status({ ...older, askedAt: sentAt + SENT_SETTLES_MS - 1 }), waiting, sent)).toBeNull()
        // Not knowing when it was asked for: kept too.
        expect(pendingTemplatesAction(status({ ...older, askedAt: undefined }), waiting, sent)).toBeNull()
        // Once it can't be stored any more, the answer settles it.
        expect(pendingTemplatesAction(status({ ...older, askedAt: sentAt + SENT_SETTLES_MS }), waiting, sent)).toBe("DISCARD")
        // Its own photo shown: decided as before, whenever asked.
        expect(pendingTemplatesAction(status({ lastReview: { id: "r3", status: "APPROVED" }, askedAt: sentAt - 1 }), waiting, sent)).toBe("PROMOTE")
        // A photo's number lasts five minutes and its save up to thirty seconds (CHALLENGE_TTL_MS).
        expect(SENT_SETTLES_MS).toBeGreaterThan(5 * 60_000 + 30_000)
        expect(readFileSync("lib/services/attendance-challenge.service.ts", "utf8")).toContain("export const CHALLENGE_TTL_MS = 5 * 60_000")
    })

    it("reads a record kept before its time was, as old", () => {
        expect(readSent(null)).toBeNull()
        expect(readSent("r1")).toEqual({ id: "r1", at: 0 })
        expect(readSent(JSON.stringify({ id: "r2", at: 5 }))).toEqual({ id: "r2", at: 5 })
    })

    it("offers permission hours under the late shift's own date, not the check-in's (review on #61)", () => {
        // A Sunday 22:00 night checked into at 00:30 Monday: Monday's balance and a Monday 22:00 request were another night's.
        const page = readFileSync("app/(dashboard)/dashboard/check-in/page.tsx", "utf8")
        expect(page).toContain("`/api/attendance/permissions/balance?date=${late.date}`")
        expect(page).toContain("initial={{ date: late.date, type: 'LATE_ARRIVAL'")
        expect(page).not.toMatch(/balance\?date=\$\{answer!?\.at|date: answer\.at\.slice\(0, 10\), type: 'LATE_ARRIVAL'/)
    })

    it("stamps the face status with when the page asked for it (review on #49)", () => {
        const page = readFileSync("app/(dashboard)/dashboard/check-in/page.tsx", "utf8")
        expect(page).toMatch(/const askedAt = Date\.now\(\)\s*const body = await fetcher\(url\)\s*return body\?\.data \? \{ \.\.\.body, data: \{ \.\.\.body\.data, askedAt \} \} : body/)
    })
})

describe("Check in waiting for the face model (review on #49)", () => {
    const status = (over: Partial<FaceStatus> = {}): FaceStatus => ({
        active: false, required: true, consent: { acceptedAt: "2026-10-03T08:00:00Z" }, consentVersion: "v", phone: null,
        pendingReview: false, reverifyDue: false, ...over,
    })

    it("only when the face check can start: asked of them and consented to", () => {
        expect(faceModelNeeded(status())).toBe(true)
        expect(faceModelNeeded(status({ required: false }))).toBe(false)
        expect(faceModelNeeded(status({ consent: null }))).toBe(false)
        expect(faceModelNeeded(undefined)).toBe(false)
        const page = readFileSync("app/(dashboard)/dashboard/check-in/page.tsx", "utf8")
        expect(page).toContain("face && faceModelNeeded(faceStatus) ? { data: faceModel, error: faceModelError } : undefined")
    })

    it("gives up on a face plugin that never answers, so Check in isn't held for good", async () => {
        vi.useFakeTimers()
        try {
            const never = withinTime(new Promise<string>(() => {}), FACE_PLUGIN_WAIT_MS, "FACE_PLUGIN_TIMEOUT")
            const caught = never.catch(e => (e as { code?: string }).code)
            await vi.advanceTimersByTimeAsync(FACE_PLUGIN_WAIT_MS)
            expect(await caught).toBe("FACE_PLUGIN_TIMEOUT")
            expect(await withinTime(Promise.resolve("ok"), FACE_PLUGIN_WAIT_MS, "X")).toBe("ok")
        } finally {
            vi.useRealTimers()
        }
        // Every wait on the plugin's info: the gate, the set-up and the check.
        const face = readFileSync("lib/mobile/face.ts", "utf8")
        // The set-up and the check each wait on it so, and nothing waits on it otherwise.
        expect(face.match(/const \{ modelVersion \} = await faceInfo\(face\)/g)).toHaveLength(2)
        expect(face).not.toMatch(/await face\.info\(\)\)?\.modelVersion|const \{ modelVersion \} = await face\.info\(\)/)
        expect(readFileSync("app/(dashboard)/dashboard/check-in/page.tsx", "utf8")).toContain("(await faceInfo(face!)).modelVersion")
    })
})
