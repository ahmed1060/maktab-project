import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { Client } from "pg"
import { checkIn, type Post } from "@/lib/mobile/check-in-flow"
import { enrolFace, settleTemplates, wrappingKey, type FaceVerifier } from "@/lib/mobile/face"
import { setUpFirst, type FaceStatus } from "@/lib/mobile/screen"
import type { CheckInDevice } from "@/lib/mobile/native"
import { parsePhoneKey } from "@/lib/attendance/phone-keys"
import { checkInSchema, challengeSchema } from "@/lib/validations/attendance-phone.schema"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { AttendanceLocationService as Locations } from "@/lib/services/attendance-location.service"
import { AttendanceCheckInService as CheckIns } from "@/lib/services/attendance-check-in.service"
import { FaceVerificationService as Face, FACE_CONSENT_VERSION } from "@/lib/services/face-verification.service"
import { FaceReviewService as Reviews } from "@/lib/services/face-review.service"
import { FaceKeyService as Keys } from "@/lib/services/face-key.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * The app's face verification (lib/mobile/face.ts) against the real server:
 * what the app would send, handed to the real services in a real Postgres.
 * A stand-in phone holds a real P-256 key, and a stand-in face SDK keeps its
 * "templates" locked with the wrapping key it was given. If the app and the
 * server ever disagree on what is signed, these fail.
 */

vi.mock("@/lib/attendance/attestation", () => ({
    attestationMode: () => "testing",
    verifyAttestation: async () => ({ verified: false, reason: "NOT_CONFIGURED" }),
}))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1500)]).toString("base64")

/** A phone with a real key, already registered and approved. */
function standInPhone(): CheckInDevice {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")
    return {
        platform: "ANDROID",
        info: async () => ({ model: "Pixel 8", appVersion: "1.0.0", pushReady: true }),
        publicKey: async () => publicKey,
        createKey: async () => publicKey,
        sign: async text => sign("sha256", Buffer.from(text), { key: pair.privateKey, dsaEncoding: "der" }).toString("base64"),
        location: async () => ({ latitude: 30.0445, longitude: 31.2357, accuracyMeters: 10, mocked: false }),
        attestation: async () => null,
    }
}

/**
 * A face SDK: templates readable only with the key they were made with, the
 * approved ones matched against, new ones kept aside until promoted.
 */
function standInFace(): FaceVerifier & { lockedWith: string | null; pendingWith: string | null; matches: boolean; deleted: number; frame: string } {
    const face = {
        lockedWith: null as string | null, pendingWith: null as string | null, matches: true, deleted: 0, frame: jpeg(),
        info: async () => ({ modelVersion: "sdk-1.2", enrolled: face.lockedWith !== null, pending: face.pendingWith !== null }),
        enrol: async (key: string) => { face.pendingWith = key; return { photo: jpeg() } },
        verify: async (key: string) => {
            if (key !== face.lockedWith) throw new Error("TEMPLATES_UNREADABLE")
            return face.matches
                ? { verified: true, score: 0.97, liveness: 0.99, attempts: 1, frame: null }
                : { verified: false, score: 0.2, liveness: 0.95, attempts: 3, frame: face.frame }
        },
        promote: async () => { face.lockedWith = face.pendingWith; face.pendingWith = null },
        discardPending: async () => { face.pendingWith = null },
        deleteTemplates: async () => { face.lockedWith = null; face.pendingWith = null; face.deleted++ },
    }
    return face
}

/** What the routes do with the body, without HTTP: the routes' checks, then the same services. */
function serverFor(userId: string): Post & { sent: string[] } {
    const sent: string[] = []
    const post = async (url: string, body: any) => {
        sent.push(url)
        if (url === "/api/attendance/phone/challenge") return Challenges.issue(userId, challengeSchema.parse(body).purpose)
        if (url === "/api/attendance/check-in") return CheckIns.checkIn("c1", userId, checkInSchema.parse(body), null)
        if (url === "/api/attendance/face/key") return Keys.fetch("c1", userId, body)
        if (url === "/api/attendance/face/key/ack") return Keys.acknowledgeDeletion("c1", userId, body)
        if (url === "/api/attendance/face/photo") return Reviews.submit("c1", userId, body)
        throw new Error(`unexpected ${url}`)
    }
    return Object.assign(post, { sent })
}

describe.skipIf(!ADMIN_URL)("the app's face verification, against the server", () => {
    /** What GET /api/attendance/face gives the app. */
    const status = async () => JSON.parse(JSON.stringify(await Face.statusFor("e1"))) as FaceStatus
    const dbName = `mobile_face_test_${Date.now()}`
    let db: Client
    const phone = standInPhone()
    const face = standInFace()

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        await db.query(`UPDATE "Company" SET timezone = 'Africa/Cairo', "faceLegalConfirmedAt" = now()`)
        await db.query(`INSERT INTO "SystemSettings"(id, "faceVerification", "updatedAt") VALUES ('default', 'ON', now()) ON CONFLICT (id) DO UPDATE SET "faceVerification" = 'ON'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        process.env.FACE_PHOTO_KEY = randomBytes(32).toString("base64")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-01-01", body: { ...STANDARD_OFFICE, faceVerificationAvailable: true } }, "a1")
        const office = await Locations.create("c1", { name: "Head office", latitude: 30.0444, longitude: 31.2357, radiusMeters: 100 }, "a1")
        await Locations.setPeople(office.id, ["e1"], "a1")
        const publicKey = (await phone.publicKey())!
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status) VALUES ('p1', 'c1', 'e1', $1, $2, 'ANDROID', 'ACTIVE')`, [publicKey, parsePhoneKey(publicKey)!.fingerprint])
        await Face.setRequired("c1", "e1", true, "a1", false)
        await Face.acceptConsent("c1", "e1", FACE_CONSENT_VERSION)
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await a.end()
    })

    it("enrols: the photo the SDK gave is signed for and waits for approval; approved, the face check is in use", async () => {
        const server = serverFor("e1")
        const review = await enrolFace(phone, face, server)
        expect(review).toMatchObject({ purpose: "ENROLMENT", status: "PENDING" })
        expect(server.sent).toEqual(["/api/attendance/phone/challenge", "/api/attendance/face/key", "/api/attendance/phone/challenge", "/api/attendance/face/photo"])
        expect(face.pendingWith).not.toBeNull()
        expect(face.lockedWith).toBeNull()
        const { rows: [row] } = await db.query(`SELECT "modelVersion" FROM "FaceReview" WHERE id = $1`, [review.id])
        expect(row.modelVersion).toBe("sdk-1.2")
        expect((await Face.statusFor("e1")).active).toBe(false)
        // Waiting: nothing to settle yet.
        expect(await settleTemplates(face, await status())).toBeNull()
        await Reviews.decide(review.id, true, null, { id: "a1", isSuperAdmin: false })
        expect((await Face.statusFor("e1")).active).toBe(true)
        // Approved: the new templates become the ones matched against.
        expect(await settleTemplates(face, await status())).toBe("PROMOTED")
        expect(face.lockedWith).not.toBeNull()
    })

    it("checks in with the face check signed in: a match counts as a match; no face check at all is flagged", async () => {
        const server = serverFor("e1")
        // Attestation is in testing, so every check-in here is flagged for that; the face reason is what differs.
        expect(await checkIn(phone, server, "IN", face)).toMatchObject({ outcome: "FLAGGED", reasons: ["ATTESTATION_UNVERIFIED"] })
        // The check-in's number is asked for alongside the face key, not after the camera (lib/mobile/check-in-flow.ts):
        // the two numbers and the key in either order, the check-in last.
        expect([...server.sent].sort()).toEqual(["/api/attendance/check-in", "/api/attendance/face/key", "/api/attendance/phone/challenge", "/api/attendance/phone/challenge"])
        expect(server.sent.at(-1)).toBe("/api/attendance/check-in")
        // An app without the face SDK, for a person it is in use for.
        expect(await checkIn(phone, serverFor("e1"), "OUT", null)).toMatchObject({ outcome: "FLAGGED", reasons: expect.arrayContaining(["FACE_UNVERIFIED"]) })
    })

    it("sends the last frame of a check that never matched, which is kept beside the flag", async () => {
        face.matches = false
        const answer = await checkIn(phone, serverFor("e1"), "IN", face)
        face.matches = true
        expect(answer).toMatchObject({ outcome: "FLAGGED", reasons: expect.arrayContaining(["FACE_UNVERIFIED"]) })
        const { rows } = await db.query(`SELECT f.id FROM "FaceFrame" f JOIN "AttendancePunch" p ON p.id = f."punchId" WHERE p."userId" = 'e1'`)
        expect(rows).toHaveLength(1)
    })

    it("re-verifies without stopping check-ins: the approved face is matched until the new one is decided (§9.5)", async () => {
        const approved = face.lockedWith
        const review = await enrolFace(phone, face, serverFor("e1"))
        expect(review).toMatchObject({ purpose: "REVERIFY", status: "PENDING" })
        // Matched against the approved templates: counts, as before.
        expect(await checkIn(phone, serverFor("e1"), "IN", face)).toMatchObject({ reasons: ["ATTESTATION_UNVERIFIED"] })
        await Reviews.decide(review.id, false, "Not them", { id: "a1", isSuperAdmin: false })
        // Rejected: the new templates go; the approved ones are untouched.
        expect(await settleTemplates(face, await status())).toBe("DISCARDED")
        expect(face.pendingWith).toBeNull()
        expect(face.lockedWith).toBe(approved)
        // Rejection stops face verification for them until they set it up again; back as before for what follows.
        await db.query(`UPDATE "CheckInPhone" SET "faceStatus" = 'APPROVED' WHERE id = 'p1'`)
    })

    it("drops new templates whose photo never reached a reviewer, instead of promoting them (review on #28)", async () => {
        const approved = face.lockedWith
        const failing = Object.assign(async (url: string, body: unknown) => {
            if (url === "/api/attendance/face/photo") throw new Error("Network down")
            return serverFor("e1")(url, body)
        }, { sent: [] as string[] })
        await expect(enrolFace(phone, face, failing)).rejects.toThrow("Network down")
        // Not known to have failed (no answer), so kept until the server says: it has no such review.
        expect(face.pendingWith).not.toBeNull()
        expect(await settleTemplates(face, await status())).toBe("DISCARDED")
        expect(face.lockedWith).toBe(approved)
        // Refused, they go at once.
        const refusing = Object.assign(async (url: string, body: unknown) => {
            if (url === "/api/attendance/face/photo") throw Object.assign(new Error("Bad photo"), { code: "FACE_PHOTO_INVALID" })
            return serverFor("e1")(url, body)
        }, { sent: [] as string[] })
        await expect(enrolFace(phone, face, refusing)).rejects.toThrow("Bad photo")
        expect(face.pendingWith).toBeNull()
        // Even had they stayed (the app stopped before sending), no review of them means they go.
        face.pendingWith = "something"
        expect(await settleTemplates(face, await status())).toBe("DISCARDED")
        expect(face.lockedWith).toBe(approved)
    })

    it("keeps the templates of a photo stored whose answer was lost, and promotes them once it is approved (review on #27)", async () => {
        const sent = { id: null as string | null, get() { return this.id }, set(id: string | null) { this.id = id } }
        const answerLost = Object.assign(async (url: string, body: unknown) => {
            const answer = await serverFor("e1")(url, body)
            if (url === "/api/attendance/face/photo") throw new Error("Network down")
            return answer
        }, { sent: [] as string[] })
        await expect(enrolFace(phone, face, answerLost, sent)).rejects.toThrow("Network down")
        const made = face.pendingWith
        expect(made).not.toBeNull()
        // The app knew the review's id before the photo went.
        const { rows: [stored] } = await db.query(`SELECT id, status FROM "FaceReview" WHERE "userId" = 'e1' ORDER BY "createdAt" DESC LIMIT 1`)
        expect(stored).toEqual({ id: sent.get(), status: "PENDING" })
        expect(await settleTemplates(face, await status(), sent)).toBeNull()
        await Reviews.decide(stored.id, true, null, { id: "a1", isSuperAdmin: false })
        expect(await settleTemplates(face, await status(), sent)).toBe("PROMOTED")
        expect(face.lockedWith).toBe(made)
    })

    it("never promotes new templates on an earlier review's approval when the app stopped before sending their photo", async () => {
        const approved = face.lockedWith
        const { rows: [earlier] } = await db.query(`SELECT id FROM "FaceReview" WHERE "userId" = 'e1' AND status = 'APPROVED' ORDER BY "createdAt" DESC LIMIT 1`)
        // Left from before: the app recorded the earlier, approved review.
        const sent = { id: earlier.id as string | null, get() { return this.id }, set(id: string | null) { this.id = id } }
        let challenges = 0
        const stopped = Object.assign(async (url: string, body: unknown) => {
            // The photo's number never comes: the app stopped with the new templates made.
            if (url === "/api/attendance/phone/challenge" && ++challenges === 2) throw new Error("App stopped")
            return serverFor("e1")(url, body)
        }, { sent: [] as string[] })
        await expect(enrolFace(phone, face, stopped, sent)).rejects.toThrow("App stopped")
        expect(face.pendingWith).not.toBeNull()
        expect(await settleTemplates(face, await status(), sent)).toBe("DISCARDED")
        expect(face.lockedWith).toBe(approved)
    })

    it("checks in without the face check when the SDK fails, flagged; not at all when the person cancels (review on #27)", async () => {
        const verify = face.verify
        try {
            face.verify = async () => { throw new Error("SDK_CRASHED") }
            const server = serverFor("e1")
            expect(await checkIn(phone, server, "IN", face)).toMatchObject({ outcome: "FLAGGED", reasons: expect.arrayContaining(["FACE_UNVERIFIED"]) })
            expect(server.sent).toContain("/api/attendance/check-in")
            face.verify = async () => { throw Object.assign(new Error("closed"), { code: "FACE_CANCELLED" }) }
            const cancelled = serverFor("e1")
            await expect(checkIn(phone, cancelled, "OUT", face)).rejects.toMatchObject({ code: "FACE_CANCELLED" })
            expect(cancelled.sent).not.toContain("/api/attendance/check-in")
        } finally {
            face.verify = verify
        }
    })

    it("on withdrawal, the phone is told to delete its templates, does, and says so; then no key", async () => {
        await Face.withdrawConsent("e1")
        expect(await wrappingKey(phone, face, serverFor("e1"))).toBeNull()
        expect(face.deleted).toBe(1)
        expect(face.lockedWith).toBeNull()
        const { rows: [k] } = await db.query(`SELECT key IS NULL AS gone, "deleteAckAt" IS NOT NULL AS acked FROM "FaceWrappingKey" WHERE "phoneId" = 'p1'`)
        expect(k).toEqual({ gone: true, acked: true })
        // The person checks in without face verification, and it isn't held against them.
        expect(await checkIn(phone, serverFor("e1"), "OUT", null)).toMatchObject({ reasons: ["ATTESTATION_UNVERIFIED"] })
    })

    it("flags a new phone's check-ins until its face is approved: changing phone doesn't turn the face check off (§9.3)", async () => {
        await Face.acceptConsent("c1", "e1", FACE_CONSENT_VERSION)
        // The face set up and approved on the old phone, a re-verification photo from it waiting; a new one asked for.
        await db.query(`UPDATE "CheckInPhone" SET "faceStatus" = 'APPROVED' WHERE id = 'p1'`)
        expect(await enrolFace(phone, standInFace(), serverFor("e1"))).toMatchObject({ purpose: "REVERIFY", status: "PENDING" })
        const next = standInPhone()
        const publicKey = (await next.publicKey())!
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status) VALUES ('p2', 'c1', 'e1', $1, $2, 'ANDROID', 'PENDING')`, [publicKey, parsePhoneKey(publicKey)!.fingerprint])
        // Held while the new phone waits: no face of its own, whatever the old one had, so not a failed match (review on #49).
        const held = await checkIn(next, serverFor("e1"), "IN", null)
        expect(held).toMatchObject({ outcome: "HELD", reasons: expect.arrayContaining(["FACE_NOT_SET_UP"]) })
        expect(held).toMatchObject({ reasons: expect.not.arrayContaining(["FACE_UNVERIFIED"]) })
        // Approved: the old phone revoked, the new one in use.
        await db.query(`UPDATE "CheckInPhone" SET status = 'REVOKED' WHERE id = 'p1'`)
        await db.query(`UPDATE "CheckInPhone" SET status = 'ACTIVE' WHERE id = 'p2'`)
        // The old phone's photo waiting doesn't stop the new one setting its face up: it would be flagged until
        // someone decided a photo from a phone no longer in use (review on #49).
        expect((await status()).pendingReview).toBe(false)
        expect(setUpFirst(await status(), { phoneActive: true, verifier: true })).toBe(true)
        expect(await checkIn(next, serverFor("e1"), "IN", null)).toMatchObject({ outcome: "FLAGGED", reasons: expect.arrayContaining(["FACE_NOT_SET_UP"]) })
        // Its photo sent and waiting: still not a face it can be matched against.
        const review = await enrolFace(next, standInFace(), serverFor("e1"))
        expect(await checkIn(next, serverFor("e1"), "OUT", null)).toMatchObject({ reasons: expect.arrayContaining(["FACE_NOT_SET_UP"]) })
        // Approved, the phone's face check is in use: no longer flagged for it.
        await Reviews.decide(review.id, true, null, { id: "a1", isSuperAdmin: false })
        const answer = await checkIn(next, serverFor("e1"), "IN", null)
        expect(answer).toMatchObject({ reasons: expect.not.arrayContaining(["FACE_NOT_SET_UP"]) })
    })
})
