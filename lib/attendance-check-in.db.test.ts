import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceCheckInService as CheckIns, checkInText } from "@/lib/services/attendance-check-in.service"
import { AttendancePhoneService as Phones } from "@/lib/services/attendance-phone.service"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { AttendanceLocationService as Locations } from "@/lib/services/attendance-location.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { AttendanceEngineService as Engine } from "@/lib/services/attendance-engine.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"
import { parsePhoneKey, signedText } from "@/lib/attendance/phone-keys"
import { phoneKeyPair } from "@/lib/attendance/test-phone"
import { calendarDateStr } from "@/lib/time"

/**
 * Checking in with the app (ATTENDANCE_PLAN.md §9.4, §9.6), against a real
 * Postgres built from the migrations: signed by the person's phone, judged
 * against their places, and stored with its evidence — or refused and
 * recorded. Attestation is replaced so each test can say whether the app
 * proved itself; the keys and signatures are real.
 */

const attested = { verified: false, asked: 0, slowMs: 0 }
vi.mock("@/lib/attendance/attestation", () => ({
    attestationMode: () => (process.env.ATTENDANCE_ATTESTATION === "required" ? "required" : "testing"),
    verifyAttestation: async () => {
        attested.asked += 1
        if (attested.slowMs) await new Promise(r => setTimeout(r, attested.slowMs))
        return { verified: attested.verified, reason: attested.verified ? null : "NOT_CONFIGURED" }
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
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Essam', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e4', 'e4@x', 'p', 'Eslam', 'Four', 'EMPLOYEE', 2026, 'e4', 'c1', NULL),
 ('e5', 'e5@x', 'p', 'Eyad', 'Five', 'EMPLOYEE', 2026, 'e5', 'c1', NULL);
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
        await Locations.setPeople(office.id, ["e1", "e2", "e4", "e5"], "a1")
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    beforeEach(() => { attested.verified = false; attested.asked = 0; attested.slowMs = 0; delete process.env.ATTENDANCE_ATTESTATION })

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
    async function checkIn(userId: string, phone: Phone, fix = AT_DESK, over: { mocked?: boolean; ip?: string | null; signWith?: Phone; at?: string } = {}) {
        const { nonce } = await Challenges.issue(userId, "CHECK_IN")
        const body = { nonce, keyFingerprint: phone.fingerprint, ...fix, mocked: over.mocked ?? false, direction: null }
        const signature = (over.signWith ?? phone).key.sign(checkInText(body))
        return CheckIns.checkIn("c1", userId, { ...body, signature }, over.ip === undefined ? "198.51.100.20" : over.ip, over.at ? new Date(over.at) : undefined)
    }
    const punches = async (userId: string) => (await db.query(`SELECT status, "flagReasons", "checkIn", source, "phoneId" FROM "AttendancePunch" WHERE "userId" = $1 ORDER BY "receivedAt"`, [userId])).rows
    const refusals = async (userId: string) => (await db.query(`SELECT reason FROM "CheckInRefusal" WHERE "userId" = $1 ORDER BY at`, [userId])).rows.map(r => r.reason)

    let e1: Phone

    it("accepts a check-in at the office from the person's phone, on the office's network, from a verified app", async () => {
        e1 = await phoneOf("e1")
        attested.verified = true
        // A slow database, as from Vercel's region to the database's: past Prisma's default 5 s the check-in was lost.
        const forPerson = Locations.forPerson.bind(Locations)
        vi.spyOn(Locations, "forPerson").mockImplementationOnce(async (...args) => {
            await new Promise(r => setTimeout(r, 5_500))
            return forPerson(...args)
        })
        // The day's rebuild and the lateness, each slowed to 2 s: side by side they cost 2 s, not 4.
        const slow = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A) => { await new Promise(r => setTimeout(r, 2_000)); return f(...a) }
        vi.spyOn(Engine, "afterChange").mockImplementationOnce(slow(Engine.afterChange.bind(Engine)))
        vi.spyOn(Engine, "expectedFor").mockImplementationOnce(slow(Engine.expectedFor.bind(Engine)))
        const started = Date.now()
        const result = await checkIn("e1", e1)
        expect(Date.now() - started).toBeLessThan(5_500 + 3_500)
        expect(result).toMatchObject({ outcome: "ACCEPTED", reasons: [], place: { name: "Head office" }, distanceMeters: 11 })
        const [punch] = await punches("e1")
        expect(punch).toMatchObject({ status: "ACCEPTED", source: "MOBILE", phoneId: e1.id, flagReasons: [] })
        expect(punch.checkIn).toMatchObject({ latitude: AT_DESK.latitude, accuracyMeters: 12, distanceMeters: 11, ip: "198.51.100.20", attested: true })
    }, 20_000)

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

    it("refuses a signature that isn't the phone's, recording it once per number however often it is sent, and a number used twice", async () => {
        const stranger = { ...e1, key: phoneKeyPair() }
        await expect(checkIn("e1", e1, AT_DESK, { signWith: stranger })).rejects.toThrow("PHONE_SIGNATURE_INVALID")
        expect((await refusals("e1")).at(-1)).toBe("BAD_SIGNATURE")
        // The same forged request sent again: the number is spent, and nothing more is recorded.
        const { nonce: forgedNonce } = await Challenges.issue("e1", "CHECK_IN")
        const forgedBody = { nonce: forgedNonce, keyFingerprint: e1.fingerprint, ...AT_DESK, mocked: false, direction: null }
        const forged = { ...forgedBody, signature: stranger.key.sign(checkInText(forgedBody)) }
        const recorded = (await refusals("e1")).length
        await expect(CheckIns.checkIn("c1", "e1", forged, null)).rejects.toThrow("PHONE_SIGNATURE_INVALID")
        await expect(CheckIns.checkIn("c1", "e1", forged, null)).rejects.toThrow("PHONE_CHALLENGE_INVALID")
        await expect(CheckIns.checkIn("c1", "e1", forged, null)).rejects.toThrow("PHONE_CHALLENGE_INVALID")
        expect(await refusals("e1")).toHaveLength(recorded + 1)
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

    it("says how late the day's first check-in is, so the app can offer permission hours; not a later one, within grace, or on a rest day", async () => {
        // 09:00–17:00 Sunday to Thursday, lateness charged after 15 minutes' grace.
        const office = await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-01-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Calendar.setDefault(office.id, "2026-01-01", "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-01-01", body: STANDARD_OFFICE }, "a1")
        const e4 = await phoneOf("e4")
        // Cairo is UTC+3 in September. Sunday 27th, 09:40: flagged while attestation is in testing, and still late.
        expect(await checkIn("e4", e4, AT_DESK, { at: "2026-09-27T06:40:00Z" })).toMatchObject({ outcome: "FLAGGED", at: "2026-09-27T09:40:00", late: { minutes: 40, startsAt: "09:00", date: "2026-09-27" } })
        // Back from lunch the same day: not the first.
        expect(await checkIn("e4", e4, AT_DESK, { at: "2026-09-27T10:00:00Z" })).toMatchObject({ late: null })
        // Monday 28th, 09:10: within the grace.
        expect(await checkIn("e4", e4, AT_DESK, { at: "2026-09-28T06:10:00Z" })).toMatchObject({ late: null })
        // Friday 25th, 10:30: a rest day.
        expect(await checkIn("e4", e4, AT_DESK, { at: "2026-09-25T07:30:00Z" })).toMatchObject({ late: null })
        // Tuesday 29th, 09:20, from a verified app: counted, and late.
        attested.verified = true
        expect(await checkIn("e4", e4, AT_DESK, { at: "2026-09-29T06:20:00Z" })).toMatchObject({ outcome: "ACCEPTED", late: { minutes: 20, startsAt: "09:00" } })
    })

    it("says nothing of lateness the engine would waive: on leave, already asked for, or excused", async () => {
        await db.query(`INSERT INTO "DayOffRequest"(id, "userId", type, date, status, "updatedAt") VALUES ('leave', 'e4', 'REGULAR', '2026-09-02', 'APPROVED', now())`)
        await db.query(`INSERT INTO "PermissionRequest"(id, "companyId", "userId", date, type, "startMinutes", "endMinutes", minutes, reason) VALUES ('perm', 'c1', 'e4', '2026-09-03', 'LATE_ARRIVAL', 540, 600, 60, 'Doctor')`)
        await db.query(`INSERT INTO "AttendanceDayDecision"(id, "companyId", "userId", date, subject, outcome, "decidedById") VALUES ('excuse', 'c1', 'e4', '2026-09-06', 'LATENESS', 'EXCUSED', 'a1')`)
        const phone = await phoneOf("e4")
        // Wednesday 2nd on leave, Thursday 3rd with a permission waiting, Sunday 6th excused: 09:40 each, and nothing to offer.
        for (const at of ["2026-09-02T06:40:00Z", "2026-09-03T06:40:00Z", "2026-09-06T06:40:00Z"]) {
            expect(await checkIn("e4", phone, AT_DESK, { at })).toMatchObject({ late: null })
        }
        // Monday 7th, nothing of the kind: late as before.
        expect(await checkIn("e4", phone, AT_DESK, { at: "2026-09-07T06:40:00Z" })).toMatchObject({ late: { minutes: 40 } })
    })

    it("offers what permission hours already asked for leave uncovered, as the engine charges it (review on #61)", async () => {
        // Tuesday 8th 09:00–09:15 granted, Wednesday 9th 09:30–10:30 waiting, Thursday 10th 09:00–09:30 granted.
        await db.query(`INSERT INTO "PermissionRequest"(id, "companyId", "userId", date, type, "startMinutes", "endMinutes", minutes, reason, status) VALUES
            ('p8', 'c1', 'e4', '2026-09-08', 'LATE_ARRIVAL', 540, 555, 15, 'Bank', 'APPROVED'),
            ('p9', 'c1', 'e4', '2026-09-09', 'LATE_ARRIVAL', 570, 630, 60, 'Doctor', 'PENDING'),
            ('p10', 'c1', 'e4', '2026-09-10', 'LATE_ARRIVAL', 540, 570, 30, 'School', 'APPROVED'),
            ('early', 'c1', 'e4', '2026-09-13', 'EARLY_LEAVE', 540, 600, 60, 'Not lateness', 'APPROVED')`)
        const phone = await phoneOf("e4")
        // 09:40 each day. The 8th: 09:15–09:40 is still charged, and is what the app offers.
        expect(await checkIn("e4", phone, AT_DESK, { at: "2026-09-08T06:40:00Z" })).toMatchObject({ late: { minutes: 25, startsAt: "09:00", date: "2026-09-08", ask: { start: "09:15", end: "09:40" } } })
        // The 9th: 09:00–09:30, before the hour asked for.
        expect(await checkIn("e4", phone, AT_DESK, { at: "2026-09-09T06:40:00Z" })).toMatchObject({ late: { minutes: 30, ask: { start: "09:00", end: "09:30" } } })
        // The 10th: ten minutes left, within the grace.
        expect(await checkIn("e4", phone, AT_DESK, { at: "2026-09-10T06:40:00Z" })).toMatchObject({ late: null })
        // Sunday 13th: an hour of early leave excuses no lateness.
        expect(await checkIn("e4", phone, AT_DESK, { at: "2026-09-13T06:40:00Z" })).toMatchObject({ late: { minutes: 40, ask: { start: "09:00", end: "09:40" } } })
    })

    it("measures a night shift's arrival against the night it starts, after midnight too, and not after the morning's check-out", async () => {
        // 22:00–06:00, nights starting Sunday to Thursday; the same policy as above.
        const night = await Calendar.createSchedule("c1", { name: "Night", version: { effectiveFrom: "2026-01-01", startMinutes: 1320, endMinutes: 1800, breakMinutes: 0 } }, "a1")
        await Calendar.assign("c1", { userIds: ["e5"], scheduleId: night.id, effectiveFrom: "2026-01-01" }, "a1")
        const e5 = await phoneOf("e5")
        // Sunday night's arrival at 00:30 on Monday: two and a half hours late for 22:00.
        // Under Sunday's date, for the balance and the permission the app offers: Monday's would be another night's (review on #61).
        expect(await checkIn("e5", e5, AT_DESK, { at: "2026-09-27T21:30:00Z" })).toMatchObject({ at: "2026-09-28T00:30:00", late: { minutes: 150, startsAt: "22:00", date: "2026-09-27" } })
        // Its check-out at 06:00 Monday: not a first check-in.
        expect(await checkIn("e5", e5, AT_DESK, { at: "2026-09-28T03:00:00Z" })).toMatchObject({ late: null })
        // Monday night's arrival at 22:30: the morning's punches were last night's, so this is the first, and late.
        expect(await checkIn("e5", e5, AT_DESK, { at: "2026-09-28T19:30:00Z" })).toMatchObject({ at: "2026-09-28T22:30:00", late: { minutes: 30, startsAt: "22:00", date: "2026-09-28" } })
        // Its check-out at 06:00 Tuesday, then Tuesday night's arrival at 00:20 Wednesday: the first of Tuesday's night,
        // though Monday night's check-out came on Tuesday too (review on #61).
        expect(await checkIn("e5", e5, AT_DESK, { at: "2026-09-29T03:00:00Z" })).toMatchObject({ late: null })
        expect(await checkIn("e5", e5, AT_DESK, { at: "2026-09-29T21:20:00Z" })).toMatchObject({ at: "2026-09-30T00:20:00", late: { minutes: 140, startsAt: "22:00", date: "2026-09-29" } })
    })

    it("asks Google or Apple once for copies of one signed check-in sent at once (review on #65)", async () => {
        const phone = await phoneOf("e1")
        const { nonce } = await Challenges.issue("e1", "CHECK_IN")
        const body = { nonce, keyFingerprint: phone.fingerprint, ...AT_DESK, mocked: false, direction: null }
        const signed = { ...body, signature: phone.key.sign(checkInText(body)) }
        attested.asked = 0
        // The provider takes a moment, as it does: every copy has been checked before any is answered.
        attested.slowMs = 200
        const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => CheckIns.checkIn("c1", "e1", signed, "198.51.100.20")))
        expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1)
        expect(outcomes.filter(o => o.status === "rejected").map(o => (o as PromiseRejectedResult).reason.message)).toEqual(Array(4).fill("PHONE_CHALLENGE_INVALID"))
        expect(attested.asked).toBe(1)
    }, 20_000)

    // Last: it approves this month's payroll, which closes the month to every later check-in here.
    it("doesn't count a held check-in in a month whose payroll was approved before the phone was", async () => {
        attested.verified = true
        const next = await phoneOf("e2", false)
        expect(await checkIn("e2", next)).toMatchObject({ outcome: "HELD" })
        // The company's month now, Cairo being UTC+2 in winter (review on #22).
        const month = calendarDateStr(new Date(), "Africa/Cairo").slice(0, 7)
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt") VALUES ('run', 'c1', $1, $2, 'APPROVED', 1, now())`, [Number(month.slice(0, 4)), Number(month.slice(5, 7))])
        await Phones.decide(next.id, { approve: true }, "a1")
        expect((await punches("e2")).filter(p => p.phoneId === next.id).map(p => p.status)).toEqual(["REJECTED"])
        // The approval's record counts it, refused for its month (review on #22).
        const { rows: [audit] } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'APPROVE_CHECK_IN_PHONE' AND "entityId" = $1`, [next.id])
        expect(audit.details).toMatchObject({ punches: 1, refused: 1 })
        // And a check-in now, in the closed month, is refused.
        expect(await checkIn("e2", next)).toEqual({ outcome: "REFUSED", reason: "MONTH_LOCKED" })
    })
})
