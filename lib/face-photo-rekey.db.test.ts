import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { Client } from "pg"
import { decryptFacePhoto, encryptFacePhoto } from "@/lib/face-photo-crypto"
import { FacePhotoKeyService as Rotation } from "@/lib/services/face-photo-key.service"

/**
 * Rotating FACE_PHOTO_KEY against a real Postgres (mobile/README.md): with
 * the new key set and the old one as FACE_PHOTO_KEY_PREVIOUS, every stored
 * face photo (a reference photo, a pending one, a flagged frame) moves to
 * the new key and still shows the same picture; one no key opens is
 * counted and left alone; and nothing is opened while no rotation is on.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(800)])
const sa = { user: { id: "sa1", role: "SUPER_ADMIN" } }

describe.skipIf(!ADMIN_URL)("rotating the face photo key, in Postgres", () => {
    const dbName = `face_rekey_test_${Date.now()}`
    let db: Client
    const oldKey = randomBytes(32).toString("base64"), newKey = randomBytes(32).toString("base64"), lostKey = randomBytes(32).toString("base64")
    const pictures = { ref: jpeg(), pending: jpeg(), frame: jpeg(), lost: jpeg() }
    const photoOf = async (table: "FaceReview" | "FaceFrame", id: string) => (await db.query(`SELECT photo FROM "${table}" WHERE id = $1`, [id])).rows[0].photo as Buffer

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
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status, "faceStatus") VALUES ('p1', 'c1', 'e1', 'k', 'f', 'ANDROID', 'ACTIVE', 'APPROVED')`)
        const before = (p: Buffer) => encryptFacePhoto(p, { FACE_PHOTO_KEY: oldKey })
        await db.query(`INSERT INTO "FaceReview"(id, "companyId", "userId", "phoneId", purpose, status, photo, "modelVersion", "decidedAt") VALUES ('ref', 'c1', 'e1', 'p1', 'ENROLMENT', 'APPROVED', $1, 'm1', now())`, [before(pictures.ref)])
        await db.query(`INSERT INTO "FaceReview"(id, "companyId", "userId", "phoneId", purpose, status, photo, "modelVersion") VALUES ('pending', 'c1', 'e1', 'p1', 'REVERIFY', 'PENDING', $1, 'm1')`, [before(pictures.pending)])
        for (const pu of ["pu1", "pu2"]) await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status) VALUES ($1, 'c1', 'e1', 'MOBILE', $1, '2026-10-01 09:00', now(), 'Africa/Cairo', 'FLAGGED')`, [pu])
        await db.query(`INSERT INTO "FaceFrame"(id, "punchId", "companyId", "userId", photo) VALUES ('frame', 'pu1', 'c1', 'e1', $1)`, [before(pictures.frame)])
        // Written with a key that is gone: neither key opens it.
        await db.query(`INSERT INTO "FaceFrame"(id, "punchId", "companyId", "userId", photo) VALUES ('lost', 'pu2', 'c1', 'e1', $1)`, [encryptFacePhoto(pictures.lost, { FACE_PHOTO_KEY: lostKey })])
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 120_000)

    afterAll(async () => {
        delete process.env.FACE_PHOTO_KEY_PREVIOUS
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("opens nothing and refuses to run while no previous key is set", async () => {
        process.env.FACE_PHOTO_KEY = newKey
        delete process.env.FACE_PHOTO_KEY_PREVIOUS
        expect(await Rotation.status()).toEqual({ rotating: false })
        await expect(Rotation.rekey(sa)).rejects.toThrow("FACE_KEY_NOT_ROTATING")
    })

    it("counts what is still on the old key, then moves it all to the new one", async () => {
        process.env.FACE_PHOTO_KEY = newKey
        process.env.FACE_PHOTO_KEY_PREVIOUS = oldKey
        expect(await Rotation.status()).toEqual({ rotating: true, total: 4, previous: 3, unreadable: 1 })

        const result = await Rotation.rekey(sa)
        expect(result).toMatchObject({ moved: 3, unreadable: 1, rotating: true, total: 4, previous: 0 })

        // The same pictures, now with the new key alone.
        const only = { FACE_PHOTO_KEY: newKey }
        expect(decryptFacePhoto(await photoOf("FaceReview", "ref"), only)).toEqual(pictures.ref)
        expect(decryptFacePhoto(await photoOf("FaceReview", "pending"), only)).toEqual(pictures.pending)
        expect(decryptFacePhoto(await photoOf("FaceFrame", "frame"), only)).toEqual(pictures.frame)
        // The one no key opens is left as it was.
        expect(decryptFacePhoto(await photoOf("FaceFrame", "lost"), { FACE_PHOTO_KEY: lostKey })).toEqual(pictures.lost)

        const audit = (await db.query(`SELECT "superAdminId", details FROM "AuditLog" WHERE action = 'REKEY_FACE_PHOTOS'`)).rows
        expect(audit).toEqual([{ superAdminId: "sa1", details: { moved: 3, unreadable: 1 } }])
    })

    it("does nothing more when run again", async () => {
        process.env.FACE_PHOTO_KEY = newKey
        process.env.FACE_PHOTO_KEY_PREVIOUS = oldKey
        const before = await photoOf("FaceReview", "ref")
        expect(await Rotation.rekey(sa)).toMatchObject({ moved: 0, unreadable: 1, previous: 0 })
        expect(await photoOf("FaceReview", "ref")).toEqual(before)
    })

    it("refuses when the previous key is the current one, rather than calling it done (review on #33)", async () => {
        process.env.FACE_PHOTO_KEY = oldKey
        process.env.FACE_PHOTO_KEY_PREVIOUS = oldKey
        expect(await Rotation.status()).toEqual({ rotating: true, sameKey: true })
        await expect(Rotation.rekey(sa)).rejects.toThrow("FACE_KEY_SAME")
    })

    it("works through many photos a bounded number per run, and says how many are left (review on #33)", async () => {
        process.env.FACE_PHOTO_KEY = newKey
        process.env.FACE_PHOTO_KEY_PREVIOUS = oldKey
        const many = 230
        for (let i = 0; i < many; i++) {
            const id = `m-${String(i).padStart(3, "0")}`
            await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status) VALUES ($1, 'c1', 'e1', 'MOBILE', $1, '2026-10-02 09:00', now(), 'Africa/Cairo', 'FLAGGED')`, [id])
            await db.query(`INSERT INTO "FaceFrame"(id, "punchId", "companyId", "userId", photo) VALUES ($1, $1, 'c1', 'e1', $2)`, [id, encryptFacePhoto(jpeg(), { FACE_PHOTO_KEY: oldKey })])
        }
        expect(await Rotation.status()).toMatchObject({ previous: many, unreadable: 1 })
        expect(await Rotation.rekey(sa)).toMatchObject({ moved: 200, previous: many - 200 })
        expect(await Rotation.rekey(sa)).toMatchObject({ moved: many - 200, previous: 0, unreadable: 1 })
    }, 120_000)
})
