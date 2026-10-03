import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { Client } from "pg"
import { parsePhoneKey } from "@/lib/attendance/phone-keys"
import { checkInText, type FaceResult } from "@/lib/attendance/signed-text"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { AttendanceLocationService as Locations } from "@/lib/services/attendance-location.service"
import { AttendanceCheckInService as CheckIns } from "@/lib/services/attendance-check-in.service"
import { AttendanceFlagService as Flags } from "@/lib/services/attendance-flag.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { FaceVerificationService as Face, FACE_CONSENT_VERSION } from "@/lib/services/face-verification.service"
import { FaceReviewService as Reviews } from "@/lib/services/face-review.service"
import { FaceKeyService as Keys } from "@/lib/services/face-key.service"
import { faceKeyText as keyText, faceDeletedText } from "@/lib/attendance/signed-text"
import { encryptFacePhoto } from "@/lib/face-photo-crypto"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * Face verification at check-in, crypto-shredding and purge
 * (ATTENDANCE_PLAN.md §9.5, §10.4, §13.8), against a real Postgres: the
 * phone's wrapping key and when it is destroyed, the face result signed into
 * the check-in, the failed frame kept only while the flag is open, and pause
 * and purge.
 */

vi.mock("@/lib/attendance/attestation", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/attendance/attestation")>()),
    attestationMode: () => "testing",
}))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1500)])
const reason = async (p: Promise<unknown>) => { try { await p; return "OK" } catch (e) { return (e as Error).message } }
const protectedSA = (over: Record<string, unknown> = {}) => ({ user: { id: "sa1", role: "SUPER_ADMIN", isProtected: true, mfaEnabled: true, stepUpAt: Date.now(), ...over } })

describe.skipIf(!ADMIN_URL)("face verification at check-in, crypto-shredding and purge, in Postgres", () => {
    const dbName = `face_keys_test_${Date.now()}`
    let db: Client
    const phones = Object.fromEntries(["e1", "e2"].map(u => {
        const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
        const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")
        return [u, { pair, publicKey, fingerprint: parsePhoneKey(publicKey)!.fingerprint }]
    }))
    const signAs = (u: string, text: string) => sign("sha256", Buffer.from(text), { key: phones[u].pair.privateKey, dsaEncoding: "der" }).toString("base64")

    const fetchKey = async (u: string) => {
        const { nonce } = await Challenges.issue(u, "FACE")
        return Keys.fetch("c1", u, { nonce, keyFingerprint: phones[u].fingerprint, signature: signAs(u, keyText(nonce, phones[u].fingerprint)) })
    }
    /** The phone says it deleted its templates, signed. */
    const ackAs = async (u: string, signer = u) => {
        const { nonce } = await Challenges.issue(u, "FACE")
        return Keys.acknowledgeDeletion("c1", u, { nonce, keyFingerprint: phones[u].fingerprint, signature: signAs(signer, faceDeletedText(nonce, phones[u].fingerprint)) })
    }
    /** A check-in as the app sends it, with the face check's result signed in when given. */
    const checkIn = async (u: string, face: FaceResult | null, extra: { faceFrame?: string; tamper?: boolean } = {}) => {
        const { nonce } = await Challenges.issue(u, "CHECK_IN")
        const body = { nonce, keyFingerprint: phones[u].fingerprint, latitude: 30.0445, longitude: 31.2357, accuracyMeters: 10, mocked: false, direction: null, face }
        const signature = signAs(u, checkInText(body))
        const sent = extra.tamper && face ? { ...body, face: { ...face, verified: true } } : body
        return CheckIns.checkIn("c1", u, { ...sent, signature, faceFrame: extra.faceFrame ?? null }, null)
    }
    const keyRow = async (u: string) => (await db.query(`SELECT k.key IS NOT NULL AS held, k."destroyedAt" IS NOT NULL AS destroyed, k."deleteAckAt" IS NOT NULL AS acked FROM "FaceWrappingKey" k WHERE k."userId" = $1`, [u])).rows[0]

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
        process.env.POSTGRES_PRISMA_URL = url.toString()
        process.env.FACE_PHOTO_KEY = randomBytes(32).toString("base64")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-01-01", body: { ...STANDARD_OFFICE, faceVerificationAvailable: true } }, "a1")
        const office = await Locations.create("c1", { name: "Head office", latitude: 30.0444, longitude: 31.2357, radiusMeters: 100 }, "a1")
        await Locations.setPeople(office.id, ["e1", "e2"], "a1")
        // Both enrolled and approved: their phones in use, a reference photo each.
        for (const u of ["e1", "e2"]) {
            await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status, "faceStatus") VALUES ($1, 'c1', $2, $3, $4, 'ANDROID', 'ACTIVE', 'APPROVED')`, [`p-${u}`, u, phones[u].publicKey, phones[u].fingerprint])
            await Face.setRequired("c1", u, true, "a1", false)
            await Face.acceptConsent("c1", u, FACE_CONSENT_VERSION)
            await db.query(`INSERT INTO "FaceReview"(id, "companyId", "userId", "phoneId", purpose, status, photo, "modelVersion", "decidedAt") VALUES ($1, 'c1', $2, $3, 'ENROLMENT', 'APPROVED', $4, 'm1', now())`, [`r-${u}`, u, `p-${u}`, encryptFacePhoto(jpeg())])
        }
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await a.end()
    })

    it("gives the phone in use its wrapping key, the same each time, signed for", async () => {
        const first = await fetchKey("e1")
        expect(first).toMatchObject({ deleteTemplates: false })
        expect(Buffer.from(first.key!, "base64")).toHaveLength(32)
        expect(await fetchKey("e1")).toEqual(first)
        const { nonce } = await Challenges.issue("e1", "FACE")
        expect(await reason(Keys.fetch("c1", "e1", { nonce, keyFingerprint: phones.e1.fingerprint, signature: signAs("e2", keyText(nonce, phones.e1.fingerprint)) }))).toBe("PHONE_SIGNATURE_INVALID")
    })

    it("counts a check-in whose face check passed, signed in; flags one without, or with a failed check", async () => {
        const passed = { verified: true, score: 0.93, liveness: 0.97, modelVersion: "m1", attempts: 1 }
        expect(await checkIn("e1", passed)).toMatchObject({ outcome: "FLAGGED", reasons: ["ATTESTATION_UNVERIFIED"] })
        expect(await checkIn("e1", null)).toMatchObject({ reasons: ["ATTESTATION_UNVERIFIED", "FACE_UNVERIFIED"] })
        // The result is signed: a failed check sent as passed doesn't verify.
        expect(await reason(checkIn("e1", { ...passed, verified: false }, { tamper: true }))).toBe("PHONE_SIGNATURE_INVALID")
        const { rows } = await db.query(`SELECT "checkIn"->'face' AS face FROM "AttendancePunch" WHERE "userId" = 'e1' ORDER BY "receivedAt"`)
        expect(rows.map(r => r.face)).toEqual([{ verified: true, score: 0.93, liveness: 0.97, modelVersion: "m1", attempts: 1 }, null])
    })

    it("shows face photos only for a check-in flagged for its face, and only the company's own reference (review on #27)", async () => {
        const viewer = { id: "a1", isSuperAdmin: false }
        const flagged = async (face: boolean) => (await db.query(
            `SELECT id FROM "AttendancePunch" WHERE "userId" = 'e1' AND status = 'FLAGGED' AND ('FACE_UNVERIFIED' = ANY("flagReasons")) = $1 LIMIT 1`, [face])).rows[0].id
        expect(await reason(Reviews.flaggedPhoto(await flagged(false), "reference", viewer))).toBe("FACE_PHOTO_NONE")
        const faceFlag = await flagged(true)
        expect(await reason(Reviews.flaggedPhoto(faceFlag, "reference", viewer))).toBe("OK")
        // The approved photo kept by a company they were in before is not this company's to show.
        await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c2', 'Two', now())`)
        await db.query(`UPDATE "FaceReview" SET "companyId" = 'c2' WHERE id = 'r-e1'`)
        expect(await reason(Reviews.flaggedPhoto(faceFlag, "reference", viewer))).toBe("FACE_PHOTO_NONE")
        await db.query(`UPDATE "FaceReview" SET "companyId" = 'c1' WHERE id = 'r-e1'`)
    })

    it("keeps a failed check's frame encrypted beside the flag, shows it only while open, and deletes it on the decision", async () => {
        const frame = jpeg()
        const sha = createHash("sha256").update(frame).digest("hex")
        await checkIn("e2", { verified: false, score: 0.31, liveness: 0.9, modelVersion: "m1", attempts: 3, frameSha256: sha }, { faceFrame: frame.toString("base64") })
        const { rows: [punch] } = await db.query(`SELECT p.id, p."flagReasons", f.photo FROM "AttendancePunch" p JOIN "FaceFrame" f ON f."punchId" = p.id WHERE p."userId" = 'e2'`)
        expect(punch.flagReasons).toContain("FACE_UNVERIFIED")
        expect(punch.photo.equals(frame)).toBe(false)
        const viewer = { id: "a1", isSuperAdmin: false }
        expect((await Reviews.flaggedPhoto(punch.id, "frame", viewer)).equals(frame)).toBe(true)
        expect((await Reviews.flaggedPhoto(punch.id, "reference", viewer)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
        await Flags.decide(punch.id, { accept: true }, "a1")
        expect((await db.query(`SELECT count(*)::int AS n FROM "FaceFrame"`)).rows[0].n).toBe(0)
        expect(await reason(Reviews.flaggedPhoto(punch.id, "frame", viewer))).toBe("FACE_REVIEW_CLOSED")
        // A frame that isn't the one signed for is dropped; the check-in is flagged all the same.
        await checkIn("e2", { verified: false, score: 0.2, liveness: 0.9, modelVersion: "m1", attempts: 3, frameSha256: sha }, { faceFrame: jpeg().toString("base64") })
        expect((await db.query(`SELECT count(*)::int AS n FROM "FaceFrame"`)).rows[0].n).toBe(0)
    })

    it("deletes a failed check's frame when its check-in is voided instead, and when the person withdraws (review on #27)", async () => {
        const failedWithFrame = async () => {
            const frame = jpeg()
            await checkIn("e2", { verified: false, score: 0.2, liveness: 0.9, modelVersion: "m1", attempts: 3, frameSha256: createHash("sha256").update(frame).digest("hex") }, { faceFrame: frame.toString("base64") })
            return (await db.query(`SELECT "punchId" FROM "FaceFrame" WHERE "userId" = 'e2'`)).rows.map(r => r.punchId)
        }
        const [voided] = await failedWithFrame()
        await Punches.voidPunch(voided, "Duplicate", "a1")
        expect((await db.query(`SELECT count(*)::int AS n FROM "FaceFrame"`)).rows[0].n).toBe(0)
        const [open] = await failedWithFrame()
        expect(open).toBeTruthy()
        await Face.withdrawConsent("e2")
        expect((await db.query(`SELECT count(*)::int AS n FROM "FaceFrame"`)).rows[0].n).toBe(0)
        expect(await reason(Reviews.flaggedPhoto(open, "frame", { id: "a1", isSuperAdmin: false }))).toBe("FACE_PHOTO_NONE")
        // Back as before for what follows: consented, enrolled.
        await Face.acceptConsent("c1", "e2", FACE_CONSENT_VERSION)
        await ackAs("e2")
        await db.query(`UPDATE "CheckInPhone" SET "faceStatus" = 'APPROVED' WHERE id = 'p-e2'`)
        await db.query(`INSERT INTO "FaceReview"(id, "companyId", "userId", "phoneId", purpose, status, photo, "modelVersion", "decidedAt") VALUES ('r-e2b', 'c1', 'e2', 'p-e2', 'ENROLMENT', 'APPROVED', $1, 'm1', now())`, [encryptFacePhoto(jpeg())])
    })

    it("keeps the key while paused; destroys it the moment the phone leaves use or its owner is archived", async () => {
        await fetchKey("e2")
        await Face.setSystemState(protectedSA(), "PAUSED")
        expect(await fetchKey("e2")).toEqual({ key: null, deleteTemplates: false })
        expect(await keyRow("e2")).toEqual({ held: true, destroyed: false, acked: false })
        await Face.setSystemState(protectedSA(), "ON")
        // Whichever code path does it, the database destroys the key.
        await db.query(`UPDATE "CheckInPhone" SET status = 'REVOKED' WHERE id = 'p-e2'`)
        expect(await keyRow("e2")).toEqual({ held: false, destroyed: true, acked: false })
        await db.query(`UPDATE "CheckInPhone" SET status = 'ACTIVE' WHERE id = 'p-e2'`)
        await fetchKey("e2")
        await db.query(`UPDATE "User" SET status = 'ARCHIVED' WHERE id = 'e2'`)
        expect(await keyRow("e2")).toMatchObject({ held: false, destroyed: true })
        await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id = 'e2'`)
        // Once destroyed, the database won't take a key back on the same row without a fresh start.
        await expect(db.query(`UPDATE "FaceWrappingKey" SET key = '\\x01' WHERE "userId" = 'e2'`)).rejects.toThrow(/destroyed_is_gone/)
    })

    it("a key fetch that arrives during a withdrawal waits for it, and gets no key (review on #27)", async () => {
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        const other = new Client({ connectionString: url.toString() })
        await other.connect()
        // The number first: issuing one touches the person's row, which would wait on its own.
        const { nonce } = await Challenges.issue("e1", "FACE")
        // A withdrawal in flight: the person locked, consent withdrawn, the key destroyed, not yet committed.
        await other.query("BEGIN")
        await other.query(`SELECT id FROM "User" WHERE id = 'e1' FOR UPDATE`)
        await other.query(`UPDATE "BiometricConsent" SET "withdrawnAt" = now() WHERE "userId" = 'e1'`)
        await other.query(`UPDATE "FaceWrappingKey" SET key = NULL, "destroyedAt" = now() WHERE "userId" = 'e1'`)
        let settled = false
        const fetching = Keys.fetch("c1", "e1", { nonce, keyFingerprint: phones.e1.fingerprint, signature: signAs("e1", keyText(nonce, phones.e1.fingerprint)) }).finally(() => { settled = true })
        await new Promise(r => setTimeout(r, 500))
        expect(settled).toBe(false)
        await other.query("COMMIT")
        await other.end()
        expect(await fetching).toEqual({ key: null, deleteTemplates: true })
        expect(await keyRow("e1")).toMatchObject({ held: false, destroyed: true })
        // Back as before for what follows.
        await Face.acceptConsent("c1", "e1", FACE_CONSENT_VERSION)
        // The phone deletes what the destroyed key locked, says so, and gets a new key.
        expect(await fetchKey("e1")).toEqual({ key: null, deleteTemplates: true })
        await ackAs("e1")
        expect((await fetchKey("e1")).key).toBeTruthy()
    })

    it("destroys the key on withdrawal and tells the phone to delete its templates, which it acknowledges", async () => {
        await Face.withdrawConsent("e1")
        expect(await keyRow("e1")).toMatchObject({ held: false, destroyed: true })
        expect(await fetchKey("e1")).toEqual({ key: null, deleteTemplates: true })
        // Only the phone itself can say so (review on #27).
        expect(await reason(ackAs("e1", "e2"))).toBe("PHONE_SIGNATURE_INVALID")
        expect(await keyRow("e1")).toEqual({ held: false, destroyed: true, acked: false })
        await ackAs("e1")
        expect(await keyRow("e1")).toEqual({ held: false, destroyed: true, acked: true })
        // Told once: with nothing left to delete, no key and nothing to do.
        expect(await fetchKey("e1")).toEqual({ key: null, deleteTemplates: false })
    })

    it("purges: only the protected Super Admin; every key and photo gone at once, the system off, and a record of both facts", async () => {
        await Face.acceptConsent("c1", "e1", FACE_CONSENT_VERSION)
        await fetchKey("e1")
        await db.query(`UPDATE "CheckInPhone" SET "faceStatus" = 'APPROVED'`)
        expect(await reason(Keys.purge(protectedSA({ isProtected: false })))).toBe("FACE_PROTECTED_ONLY")
        expect(await reason(Keys.purge(protectedSA({ stepUpAt: 0 })))).toBe("STEP_UP_REQUIRED")
        const out = await Keys.purge(protectedSA())
        expect(out).toMatchObject({ keysDestroyed: 1, photosDeleted: 1 })
        expect(await Face.systemState()).toBe("OFF")
        expect((await db.query(`SELECT count(*)::int AS n FROM "FaceWrappingKey" WHERE key IS NOT NULL`)).rows[0].n).toBe(0)
        expect((await db.query(`SELECT count(*)::int AS n FROM "FaceReview" WHERE photo IS NOT NULL`)).rows[0].n).toBe(0)
        expect((await db.query(`SELECT DISTINCT "faceStatus" FROM "CheckInPhone"`)).rows).toEqual([{ faceStatus: "NONE" }])
        expect(await Keys.lastPurge()).toMatchObject({ keysDestroyed: 1, photosDeleted: 1, acknowledged: 0 })
        // The system is off, yet a phone that asks is told to delete (review on #27).
        expect(await fetchKey("e1")).toEqual({ key: null, deleteTemplates: true })
        await ackAs("e1")
        // e2's key was destroyed before the purge (archived): its phone saying so now isn't this purge's.
        await ackAs("e2")
        expect(await Keys.lastPurge()).toMatchObject({ keysDestroyed: 1, acknowledged: 1 })
        expect(await fetchKey("e1")).toEqual({ key: null, deleteTemplates: false })
        const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'PURGE_FACE_VERIFICATION'`)
        expect(rows).toEqual([{ details: { faceVerification: { old: "ON", new: "OFF" }, keysDestroyed: 1, photosDeleted: 1 } }])
    })

    it("removes a key with its phone, even when the phone is deleted outright (review on #27)", async () => {
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status) VALUES ('p-x', 'c1', 'e1', 'k', $1, 'ANDROID', 'PENDING')`, ["f".repeat(64)])
        await db.query(`INSERT INTO "FaceWrappingKey"(id, "phoneId", "userId", key) VALUES ('k-x', 'p-x', 'e1', '\\x01')`)
        await db.query(`DELETE FROM "CheckInPhone" WHERE id = 'p-x'`)
        expect((await db.query(`SELECT count(*)::int AS n FROM "FaceWrappingKey" WHERE id = 'k-x'`)).rows[0].n).toBe(0)
    })
})
