import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { generateKeyPairSync, sign } from "node:crypto"
import { Client } from "pg"
import { parsePhoneKey } from "@/lib/attendance/phone-keys"
import { attestedText, checkInText, signedText } from "@/lib/attendance/signed-text"
import { fakeAppAttestKey } from "@/lib/attendance/fixtures/fake-app-attest"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { AttendancePhoneService as Phones } from "@/lib/services/attendance-phone.service"
import { AttendanceCheckInService as CheckIns } from "@/lib/services/attendance-check-in.service"
import { AttendanceLocationService as Locations } from "@/lib/services/attendance-location.service"

/**
 * Attestation wired into registering and checking in (ATTENDANCE_PLAN.md
 * §9.4), with the real verifiers against a real Postgres: an iPhone's App
 * Attest key is kept when it registers, each check-in's assertion is
 * checked with it, its counter only goes up, and why anything isn't
 * verified is kept for the Super Admin. Only Apple's signature on the
 * registration is stood in for: that needs a real iPhone.
 */

const APP_ID = "TEAM123456.com.shsd.nizmo"
const appAttestKey = fakeAppAttestKey(APP_ID)

vi.mock("@/lib/attendance/app-attest", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/attendance/app-attest")>()),
    // Apple's part: as if Apple attested our key over this number.
    verifyAppAttestation: ({ challenge }: { challenge: string }) => {
        if (!challenge.startsWith("nizmo-attest|REGISTER|")) throw new Error("attested the wrong text")
        return { publicKey: appAttestKey.publicKey, counter: 0, environment: "production" }
    },
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

/** A phone's signing key, as its secure hardware holds it. */
function signingKey() {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")
    return { publicKey, fingerprint: parsePhoneKey(publicKey)!.fingerprint, sign: (text: string) => sign("sha256", Buffer.from(text), { key: pair.privateKey, dsaEncoding: "der" }).toString("base64") }
}

describe.skipIf(!ADMIN_URL)("attestation at registration and check-in, in Postgres", () => {
    const dbName = `attest_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        await db.query(`UPDATE "Company" SET timezone = 'Africa/Cairo'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        process.env.APP_ATTEST_APP_ID = APP_ID
        delete process.env.ATTENDANCE_ATTESTATION
        delete process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT
        delete process.env.FCM_SERVICE_ACCOUNT
        const office = await Locations.create("c1", { name: "Head office", latitude: 30.0444, longitude: 31.2357, radiusMeters: 100 }, "a1")
        await Locations.setPeople(office.id, ["e1", "e2"], "a1")
    }, 180_000)

    afterAll(async () => {
        delete process.env.APP_ATTEST_APP_ID
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const iphone = signingKey()
    const register = async (userId: string, key: ReturnType<typeof signingKey>, platform: "IOS" | "ANDROID", attestation: string | null) => {
        const { nonce } = await Challenges.issue(userId, "REGISTER")
        return Phones.register("c1", userId, { nonce, publicKey: key.publicKey, signature: key.sign(signedText("REGISTER", nonce, [key.fingerprint, platform])), platform, attestation })
    }
    /** A check-in's body, signed; the attestation made from its number. */
    const checkInBody = async (userId: string, key: ReturnType<typeof signingKey>, attest: (text: string) => string | null) => {
        const { nonce } = await Challenges.issue(userId, "CHECK_IN")
        const body = { nonce, keyFingerprint: key.fingerprint, latitude: 30.0445, longitude: 31.2357, accuracyMeters: 10, mocked: false, direction: null }
        return { ...body, signature: key.sign(checkInText(body)), attestation: attest(attestedText("CHECK_IN", nonce)) }
    }
    const lastEvidence = async (userId: string) => (await db.query(`SELECT status, "flagReasons", "checkIn" FROM "AttendancePunch" WHERE "userId" = $1 ORDER BY "receivedAt" DESC LIMIT 1`, [userId])).rows[0]
    const counter = async (id: string) => (await db.query(`SELECT "appAttestCounter" AS n FROM "CheckInPhone" WHERE id = $1`, [id])).rows[0].n

    let phoneId: string

    it("keeps an iPhone's attested key when it registers, and says it was attested", async () => {
        const phone = await register("e1", iphone, "IOS", JSON.stringify({ keyId: "a2V5", attestation: "b2JqZWN0" }))
        expect(phone).toMatchObject({ attested: true, platform: "IOS" })
        phoneId = phone.id
        const { rows: [row] } = await db.query(`SELECT "appAttestKey", "appAttestCounter" FROM "CheckInPhone" WHERE id = $1`, [phone.id])
        expect(row).toEqual({ appAttestKey: appAttestKey.publicKey, appAttestCounter: 0 })
        await Phones.decide(phone.id, { approve: true }, "a1")
    })

    it("accepts a check-in whose assertion the key signed, and keeps the counter", async () => {
        const body = await checkInBody("e1", iphone, text => JSON.stringify({ assertion: appAttestKey.assertion(text, 1) }))
        expect(await CheckIns.checkIn("c1", "e1", body, null)).toMatchObject({ outcome: "ACCEPTED", reasons: [] })
        expect((await lastEvidence("e1")).checkIn).toMatchObject({ attested: true, attestationReason: null })
        expect(await counter(phoneId)).toBe(1)
    })

    it("flags an assertion whose counter was used, and says why", async () => {
        const body = await checkInBody("e1", iphone, text => JSON.stringify({ assertion: appAttestKey.assertion(text, 1) }))
        expect(await CheckIns.checkIn("c1", "e1", body, null)).toMatchObject({ outcome: "FLAGGED", reasons: ["ATTESTATION_UNVERIFIED"] })
        expect((await lastEvidence("e1")).checkIn).toMatchObject({ attested: false, attestationReason: "BAD_COUNTER" })
        expect(await counter(phoneId)).toBe(1)
    })

    it("flags an assertion from another key, and leaves the counter", async () => {
        const other = fakeAppAttestKey(APP_ID)
        const body = await checkInBody("e1", iphone, text => JSON.stringify({ assertion: other.assertion(text, 9) }))
        expect(await CheckIns.checkIn("c1", "e1", body, null)).toMatchObject({ outcome: "FLAGGED" })
        expect((await lastEvidence("e1")).checkIn).toMatchObject({ attested: false, attestationReason: "BAD_SIGNATURE" })
        expect(await counter(phoneId)).toBe(1)
    })

    it("keeps why an Android phone wasn't verified: no service account yet", async () => {
        const android = signingKey()
        const phone = await register("e2", android, "ANDROID", "integrity-token")
        expect(phone.attested).toBe(false)
        await Phones.decide(phone.id, { approve: true }, "a1")
        const body = await checkInBody("e2", android, () => "integrity-token")
        expect(await CheckIns.checkIn("c1", "e2", body, null)).toMatchObject({ outcome: "FLAGGED" })
        expect((await lastEvidence("e2")).checkIn).toMatchObject({ attested: false, attestationReason: "NOT_CONFIGURED" })
        const { rows: [audit] } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'REGISTER_CHECK_IN_PHONE' AND "entityId" = $1`, [phone.id])
        expect(audit.details).toMatchObject({ attested: false, attestationReason: "NOT_CONFIGURED" })
    })
})
