import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceCheckInService as CheckIns, checkInText } from "@/lib/services/attendance-check-in.service"
import { AttendancePhoneService as Phones } from "@/lib/services/attendance-phone.service"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { AttendanceLocationService as Locations } from "@/lib/services/attendance-location.service"
import { parsePhoneKey, signedText } from "@/lib/attendance/phone-keys"
import { phoneKeyPair } from "@/lib/attendance/test-phone"

/**
 * Checking in with the app (ATTENDANCE_PLAN.md §9.4, §9.6), against a real
 * Postgres built from the migrations: signed by the person's phone, judged
 * against their places, and stored with its evidence — or refused and
 * recorded. Attestation is replaced so each test can say whether the app
 * proved itself; the keys and signatures are real.
 */

const attested = { verified: false }
vi.mock("@/lib/attendance/attestation", () => ({
    attestationMode: () => (process.env.ATTENDANCE_ATTESTATION === "required" ? "required" : "testing"),
    verifyAttestation: async () => ({ verified: attested.verified, reason: attested.verified ? null : "NOT_CONFIGURED" }),
}))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Essam', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL);
`

// Tahrir: the office's centre; about 11 m away; about 333 m away.
const OFFICE = { latitude: 30.0444, longitude: 31.2357 }
const AT_DESK = { latitude: 30.0445, longitude: 31.2357, accuracyMeters: 12 }
const DOWN_THE_ROAD = { latitude: 30.0474, longitude: 31.2357, accuracyMeters: 12 }

describe.skipIf(!ADMIN_URL)("checking in with the app, in Postgres", () => {
    const dbName = `check_in_test_${Date.now()}`
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
        await db.query(`UPDATE "Company" SET timezone = 'Africa/Cairo' WHERE id = 'c1'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        const office = await Locations.create("c1", { name: "Head office", ...OFFICE, radiusMeters: 100, officeIpRanges: ["198.51.100.0/24"] }, "a1")
        await Locations.setPeople(office.id, ["e1", "e2"], "a1")
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    beforeEach(() => { attested.verified = false; delete process.env.ATTENDANCE_ATTESTATION })

    /** A phone of this person's, registered and — unless asked otherwise — approved. */
    async function phoneOf(userId: string, approve = true) {
        const key = phoneKeyPair()
        const fingerprint = parsePhoneKey(key.publicBase64)!.fingerprint
        const { nonce } = await Challenges.issue(userId, "REGISTER")
        const phone = await Phones.register("c1", userId, { nonce, publicKey: key.publicBase64, signature: key.sign(signedText("REGISTER", nonce, [fingerprint, "ANDROID"])), platform: "ANDROID", model: "Pixel" })
        if (approve) await Phones.decide(phone.id, { approve: true }, "a1")
        return { ...phone, key, fingerprint }
    }
    type Phone = Awaited<ReturnType<typeof phoneOf>>

    /** What the app does: a number, a fix, a signature. */
    async function checkIn(userId: string, phone: Phone, fix = AT_DESK, over: { mocked?: boolean; ip?: string | null; signWith?: Phone } = {}) {
        const { nonce } = await Challenges.issue(userId, "CHECK_IN")
        const body = { nonce, keyFingerprint: phone.fingerprint, ...fix, mocked: over.mocked ?? false, direction: null }
        const signature = (over.signWith ?? phone).key.sign(checkInText(body))
        return CheckIns.checkIn("c1", userId, { ...body, signature }, over.ip === undefined ? "198.51.100.20" : over.ip)
    }
    const punches = async (userId: string) => (await db.query(`SELECT status, "flagReasons", "checkIn", source, "phoneId" FROM "AttendancePunch" WHERE "userId" = $1 ORDER BY "receivedAt"`, [userId])).rows
    const refusals = async (userId: string) => (await db.query(`SELECT reason FROM "CheckInRefusal" WHERE "userId" = $1 ORDER BY at`, [userId])).rows.map(r => r.reason)

    let e1: Phone

    it("accepts a check-in at the office from the person's phone, on the office's network, from a verified app", async () => {
        e1 = await phoneOf("e1")
        attested.verified = true
        const result = await checkIn("e1", e1)
        expect(result).toMatchObject({ outcome: "ACCEPTED", reasons: [], place: { name: "Head office" }, distanceMeters: 11 })
        const [punch] = await punches("e1")
        expect(punch).toMatchObject({ status: "ACCEPTED", source: "MOBILE", phoneId: e1.id, flagReasons: [] })
        expect(punch.checkIn).toMatchObject({ latitude: AT_DESK.latitude, accuracyMeters: 12, distanceMeters: 11, ip: "198.51.100.20", attested: true })
    })

    it("flags every check-in for the Super Admin while attestation is in testing, and it doesn't count until decided", async () => {
        expect(await checkIn("e1", e1)).toMatchObject({ outcome: "FLAGGED", reasons: ["ATTESTATION_UNVERIFIED"] })
        expect((await punches("e1")).at(-1)).toMatchObject({ status: "FLAGGED", flagReasons: ["ATTESTATION_UNVERIFIED"] })
    })

    it("flags a check-in down the road and off the office's network, naming both", async () => {
        attested.verified = true
        expect(await checkIn("e1", e1, DOWN_THE_ROAD, { ip: "203.0.113.9" })).toMatchObject({ outcome: "FLAGGED", reasons: ["OUTSIDE_AREA", "OFFICE_IP_MISMATCH"], distanceMeters: 334 })
    })

    it("refuses a simulated location, recording it and storing no punch", async () => {
        const before = (await punches("e1")).length
        expect(await checkIn("e1", e1, AT_DESK, { mocked: true })).toEqual({ outcome: "REFUSED", reason: "MOCK_LOCATION" })
        expect(await punches("e1")).toHaveLength(before)
        expect(await refusals("e1")).toEqual(["MOCK_LOCATION"])
    })

    it("refuses an unverified app once attestation is required", async () => {
        process.env.ATTENDANCE_ATTESTATION = "required"
        expect(await checkIn("e1", e1)).toEqual({ outcome: "REFUSED", reason: "ATTESTATION_FAILED" })
    })

    it("refuses a signature that isn't the phone's, and a number used twice", async () => {
        const stranger = { ...e1, key: phoneKeyPair() }
        await expect(checkIn("e1", e1, AT_DESK, { signWith: stranger })).rejects.toThrow("PHONE_SIGNATURE_INVALID")
        expect((await refusals("e1")).at(-1)).toBe("BAD_SIGNATURE")
        const { nonce } = await Challenges.issue("e1", "CHECK_IN")
        const body = { nonce, keyFingerprint: e1.fingerprint, ...AT_DESK, mocked: false, direction: null }
        const signed = { ...body, signature: e1.key.sign(checkInText(body)) }
        await CheckIns.checkIn("c1", "e1", signed, null)
        await expect(CheckIns.checkIn("c1", "e1", signed, null)).rejects.toThrow("PHONE_CHALLENGE_INVALID")
    })

    it("refuses a phone that isn't the person's", async () => {
        const e2 = await phoneOf("e2")
        // Ehab's number, signed by Eman's phone: not one of Ehab's.
        expect(await checkIn("e1", e2)).toEqual({ outcome: "REFUSED", reason: "NOT_REGISTERED_PHONE" })
    })

    it("refuses someone with nowhere to check in", async () => {
        const e3 = await phoneOf("e3")
        expect(await checkIn("e3", e3)).toEqual({ outcome: "REFUSED", reason: "NO_WORK_LOCATION" })
    })

    it("changes phone at the moment of asking: the old one is refused, the new one's check-ins are held and flagged or counted on approval", async () => {
        attested.verified = true
        const next = await phoneOf("e1", false)
        expect(await checkIn("e1", e1)).toEqual({ outcome: "REFUSED", reason: "PHONE_SUSPENDED" })
        expect(await checkIn("e1", next)).toMatchObject({ outcome: "HELD", reasons: [] })
        expect(await checkIn("e1", next, DOWN_THE_ROAD)).toMatchObject({ outcome: "HELD", reasons: ["OUTSIDE_AREA"] })
        await Phones.decide(next.id, { approve: true }, "a1")
        const held = (await punches("e1")).filter(p => p.phoneId === next.id)
        expect(held.map(p => p.status)).toEqual(["ACCEPTED", "FLAGGED"])
    })
})
