import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { Client } from "pg"
import { checkIn, type Post } from "@/lib/mobile/check-in-flow"
import { enrolFace, wrappingKey, type FaceVerifier } from "@/lib/mobile/face"
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

/** A face SDK: its templates readable only with the key they were made with. */
function standInFace(): FaceVerifier & { lockedWith: string | null; matches: boolean; deleted: number; frame: string } {
    const face = {
        lockedWith: null as string | null, matches: true, deleted: 0, frame: jpeg(),
        info: async () => ({ modelVersion: "sdk-1.2", enrolled: face.lockedWith !== null }),
        enrol: async (key: string) => { face.lockedWith = key; return { photo: jpeg() } },
        verify: async (key: string) => {
            if (key !== face.lockedWith) throw new Error("TEMPLATES_UNREADABLE")
            return face.matches
                ? { verified: true, score: 0.97, liveness: 0.99, attempts: 1, frame: null }
                : { verified: false, score: 0.2, liveness: 0.95, attempts: 3, frame: face.frame }
        },
        deleteTemplates: async () => { face.lockedWith = null; face.deleted++ },
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
        expect(face.lockedWith).not.toBeNull()
        const { rows: [row] } = await db.query(`SELECT "modelVersion" FROM "FaceReview" WHERE id = $1`, [review.id])
        expect(row.modelVersion).toBe("sdk-1.2")
        expect((await Face.statusFor("e1")).active).toBe(false)
        await Reviews.decide(review.id, true, null, { id: "a1", isSuperAdmin: false })
        expect((await Face.statusFor("e1")).active).toBe(true)
    })

    it("checks in with the face check signed in: a match counts as a match; no face check at all is flagged", async () => {
        const server = serverFor("e1")
        // Attestation is in testing, so every check-in here is flagged for that; the face reason is what differs.
        expect(await checkIn(phone, server, "IN", face)).toMatchObject({ outcome: "FLAGGED", reasons: ["ATTESTATION_UNVERIFIED"] })
        expect(server.sent).toEqual(["/api/attendance/phone/challenge", "/api/attendance/face/key", "/api/attendance/phone/challenge", "/api/attendance/check-in"])
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
})
