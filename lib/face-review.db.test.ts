import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { Client } from "pg"
import { parsePhoneKey } from "@/lib/attendance/phone-keys"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { FaceVerificationService as Face, FACE_CONSENT_VERSION } from "@/lib/services/face-verification.service"
import { FaceReviewService as Reviews, faceText } from "@/lib/services/face-review.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * The verification photo and its review (lib/services/face-review.service.ts,
 * ATTENDANCE_PLAN.md §9.5), against a real Postgres: sent signed from the
 * phone in use, stored encrypted, shown only through an open review with
 * every view audited, and deleted when rejected, replaced or withdrawn.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`
/** A small JPEG-looking photo: the server checks the header, and the bytes round-trip. */
const jpeg = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)])
const reason = async (p: Promise<unknown>) => { try { await p; return "OK" } catch (e) { return (e as Error).message } }
const admin = { id: "a1", isSuperAdmin: false }

describe.skipIf(!ADMIN_URL)("face verification photos, in Postgres", () => {
    const dbName = `face_review_test_${Date.now()}`
    let db: Client
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")
    const keyFingerprint = parsePhoneKey(publicKey)!.fingerprint

    /** A photo as the app sends it: a fresh number, signed with the phone's key over the photo's hash. */
    const send = async (photo: Buffer, over: Partial<{ signature: string }> = {}) => {
        const { nonce } = await Challenges.issue("e1", "FACE")
        const photoSha256 = createHash("sha256").update(photo).digest("hex")
        const signature = sign("sha256", Buffer.from(faceText({ nonce, keyFingerprint, photoSha256, modelVersion: "m1" })), { key: pair.privateKey, dsaEncoding: "der" }).toString("base64")
        return Reviews.submit("c1", "e1", { nonce, keyFingerprint, signature, photo: photo.toString("base64"), modelVersion: "m1", ...over })
    }
    const reviews = async () => (await db.query(`SELECT id, purpose, status, photo IS NOT NULL AS "hasPhoto" FROM "FaceReview" ORDER BY "createdAt"`)).rows
    const phoneFace = async () => (await db.query(`SELECT "faceStatus" FROM "CheckInPhone" WHERE id = 'p1'`)).rows[0].faceStatus
    const critical = async () => (await db.query(`SELECT "userId", "superAdminId", read, "relatedId" FROM "Notification" WHERE type = 'ATTENDANCE_FACE_REVIEW' ORDER BY "createdAt", "userId"`)).rows

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
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        await db.query(`INSERT INTO "SystemSettings"(id, "faceVerification", "updatedAt") VALUES ('default', 'ON', now()) ON CONFLICT (id) DO UPDATE SET "faceVerification" = 'ON'`)
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status) VALUES ('p1', 'c1', 'e1', $1, $2, 'ANDROID', 'ACTIVE')`, [publicKey, keyFingerprint])
        process.env.POSTGRES_PRISMA_URL = url.toString()
        process.env.FACE_PHOTO_KEY = randomBytes(32).toString("base64")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-01-01", body: { ...STANDARD_OFFICE, faceVerificationAvailable: true } }, "a1")
        await Face.setRequired("c1", "e1", true, "a1", false)
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await a.end()
    })

    it("takes no photo before consent, nor one that isn't a photo, nor one the phone didn't sign", async () => {
        expect(await reason(send(jpeg()))).toBe("FACE_CONSENT_REQUIRED")
        await Face.acceptConsent("c1", "e1", FACE_CONSENT_VERSION)
        expect(await reason(send(Buffer.from("not a photo")))).toBe("FACE_PHOTO_INVALID")
        expect(await reason(send(jpeg(500 * 1024)))).toBe("FACE_PHOTO_INVALID")
        expect(await reason(send(jpeg(), { signature: "AAAA" }))).toBe("PHONE_SIGNATURE_INVALID")
        expect(await reviews()).toEqual([])
    })

    const first = jpeg()
    it("keeps a signed photo encrypted, waiting for a decision, and tells every reviewer at once, critically", async () => {
        const review = await send(first)
        expect(review).toMatchObject({ purpose: "ENROLMENT", status: "PENDING" })
        expect(await phoneFace()).toBe("PENDING")
        const { rows: [stored] } = await db.query(`SELECT photo FROM "FaceReview"`)
        expect(stored.photo.equals(first)).toBe(false)
        expect(stored.photo.includes(first.subarray(4, 64))).toBe(false)
        expect((await critical()).map(n => [n.userId, n.superAdminId, n.read])).toEqual([["a1", null, false], [null, "sa1", false]])
        // Not active until a person approves the photo.
        expect(await Face.statusFor("e1")).toMatchObject({ active: false, pendingReview: true, phone: { faceStatus: "PENDING" } })
    })

    it("replaces a photo still waiting, deleting it", async () => {
        const replacing = jpeg()
        await send(replacing)
        expect((await reviews()).map(r => [r.status, r.hasPhoto])).toEqual([["WITHDRAWN", false], ["PENDING", true]])
        // The first one's notices are done with.
        expect((await critical()).filter(n => !n.read)).toHaveLength(2)
    })

    it("shows the photo only through the open review, every view audited", async () => {
        const [, waiting] = await reviews()
        const shown = await Reviews.photo(waiting.id, "new", admin)
        expect(shown.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
        expect(await reason(Reviews.photo(waiting.id, "reference", admin))).toBe("FACE_PHOTO_NONE")
        const { rows } = await db.query(`SELECT "userId", details FROM "AuditLog" WHERE action = 'VIEW_FACE_PHOTO'`)
        expect(rows).toEqual([{ userId: "a1", details: { companyId: "c1", userId: "e1", which: "new" } }])
    })

    it("approves it: it becomes the reference, face verification is on, and the critical notices are done", async () => {
        const [, waiting] = await reviews()
        expect(await Reviews.decide(waiting.id, true, null, admin)).toEqual({ id: waiting.id, status: "APPROVED" })
        expect(await reason(Reviews.decide(waiting.id, false, null, admin))).toBe("FACE_REVIEW_CLOSED")
        expect(await phoneFace()).toBe("APPROVED")
        expect(await Face.statusFor("e1")).toMatchObject({ active: true, pendingReview: false })
        expect((await critical()).every(n => n.read)).toBe(true)
        // Decided: nothing reaches its photo any more.
        expect(await reason(Reviews.photo(waiting.id, "new", admin))).toBe("FACE_REVIEW_CLOSED")
        const { rows } = await db.query(`SELECT "messageKey" FROM "Notification" WHERE "userId" = 'e1' AND type = 'ATTENDANCE_FACE'`)
        expect(rows).toEqual([{ messageKey: "notice_face_approved" }])
    })

    it("asks for re-verification; a rejected new photo is deleted, the reference stays, and face verification stops", async () => {
        await Reviews.requestReverify("c1", "e1", admin)
        expect(await Face.statusFor("e1")).toMatchObject({ reverifyDue: true })
        const again = await send(jpeg())
        expect(again).toMatchObject({ purpose: "REVERIFY" })
        // The reviewer compares the new photo with the approved one.
        expect((await Reviews.photo(again.id, "reference", admin)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
        await Reviews.decide(again.id, false, "Not them", admin)
        expect((await reviews()).map(r => [r.purpose, r.status, r.hasPhoto])).toEqual([
            ["ENROLMENT", "WITHDRAWN", false], ["ENROLMENT", "APPROVED", true], ["REVERIFY", "REJECTED", false],
        ])
        expect(await phoneFace()).toBe("REJECTED")
        expect(await Face.statusFor("e1")).toMatchObject({ active: false })
        // The database itself refuses a kept photo on a rejected review.
        await expect(db.query(`UPDATE "FaceReview" SET photo = '\\x00' WHERE status = 'REJECTED'`)).rejects.toThrow(/photo_only_while_kept/)
    })

    it("deletes every photo of them when they withdraw consent", async () => {
        await Face.withdrawConsent("e1")
        expect((await reviews()).filter(r => r.hasPhoto)).toEqual([])
        expect(await phoneFace()).toBe("NONE")
    })
})
