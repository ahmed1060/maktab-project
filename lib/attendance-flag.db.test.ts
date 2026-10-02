import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceFlagService as Flags } from "@/lib/services/attendance-flag.service"
import { AttendanceCheckInService as CheckIns, checkInText } from "@/lib/services/attendance-check-in.service"
import { AttendancePhoneService as Phones } from "@/lib/services/attendance-phone.service"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { AttendanceLocationService as Locations } from "@/lib/services/attendance-location.service"
import { parsePhoneKey, signedText } from "@/lib/attendance/phone-keys"
import { phoneKeyPair } from "@/lib/attendance/test-phone"

/**
 * Flagged check-ins, decided (ATTENDANCE_PLAN.md §9.6, §13.1, §13.7):
 * routed to the company or the Super Admin by why they were flagged,
 * accepted or rejected with the owner told, never in an approved month;
 * and the integrity view across companies. Real check-ins in a real
 * Postgres; attestation is replaced so each test can say whether the app
 * proved itself.
 */

const attested = { verified: false }
vi.mock("@/lib/attendance/attestation", () => ({
    attestationMode: () => "testing",
    verifyAttestation: async () => ({ verified: attested.verified, reason: attested.verified ? null : "NOT_CONFIGURED" }),
}))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL),
 ('x2', 'x2@x', 'p', 'Xena', 'Two', 'EMPLOYEE', 2026, 'x2', 'c2', NULL);
`

const OFFICE = { latitude: 30.0444, longitude: 31.2357 }
const AT_DESK = { latitude: 30.0445, longitude: 31.2357, accuracyMeters: 12 }
const DOWN_THE_ROAD = { latitude: 30.0474, longitude: 31.2357, accuracyMeters: 12 }

describe.skipIf(!ADMIN_URL)("flagged check-ins, in Postgres", () => {
    const dbName = `flags_test_${Date.now()}`
    let db: Client
    const phones: Record<string, { key: ReturnType<typeof phoneKeyPair>; fingerprint: string }> = {}

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
        await db.query(`INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES ('sa', 'sa@x', 'sa', 'p', 'Sara', 'Admin', now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        for (const [companyId, userId, adminId] of [["c1", "e1", "a1"], ["c2", "x2", "a2"]] as const) {
            const place = await Locations.create(companyId, { name: `Office ${companyId}`, ...OFFICE, radiusMeters: 100, everyone: true }, adminId)
            void place
            const key = phoneKeyPair(), fingerprint = parsePhoneKey(key.publicBase64)!.fingerprint
            const { nonce } = await Challenges.issue(userId, "REGISTER")
            const phone = await Phones.register(companyId, userId, { nonce, publicKey: key.publicBase64, signature: key.sign(signedText("REGISTER", nonce, [fingerprint, "ANDROID"])), platform: "ANDROID" })
            await Phones.decide(phone.id, { approve: true }, adminId)
            phones[userId] = { key, fingerprint }
        }
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    beforeEach(() => { attested.verified = false })

    async function checkIn(companyId: string, userId: string, fix = AT_DESK, mocked = false) {
        const { key, fingerprint } = phones[userId]
        const { nonce } = await Challenges.issue(userId, "CHECK_IN")
        const body = { nonce, keyFingerprint: fingerprint, ...fix, mocked, direction: null }
        await CheckIns.checkIn(companyId, userId, { ...body, signature: key.sign(checkInText(body)) }, null)
        const { rows: [p] } = await db.query(`SELECT id FROM "AttendancePunch" WHERE "userId" = $1 ORDER BY "receivedAt" DESC LIMIT 1`, [userId])
        return p?.id as string
    }
    const status = async (id: string) => (await db.query(`SELECT status FROM "AttendancePunch" WHERE id = $1`, [id])).rows[0].status
    const notices = async (userId: string) => (await db.query(`SELECT "messageKey" FROM "Notification" WHERE "userId" = $1 AND type = 'ATTENDANCE_CHECK_IN' ORDER BY "createdAt"`, [userId])).rows.map(r => r.messageKey)

    let unverified: string, outside: string

    it("waits for the Super Admin when our app couldn't prove itself, and for the company otherwise", async () => {
        unverified = await checkIn("c1", "e1")
        attested.verified = true
        outside = await checkIn("c1", "e1", DOWN_THE_ROAD)
        const theirs = await Flags.list("COMPANY", { companyId: "c1", visible: { kind: "COMPANY" } })
        expect(theirs.map(f => f.id)).toEqual([outside])
        expect(theirs[0]).toMatchObject({ name: "Ehab One", flagReasons: ["OUTSIDE_AREA"], workLocation: { name: "Office c1" }, checkIn: { distanceMeters: 334 } })
        const platform = await Flags.list("PLATFORM", "ALL")
        expect(platform.map(f => f.id)).toEqual([unverified])
        expect(platform[0]).toMatchObject({ companyName: "One", flagReasons: ["ATTESTATION_UNVERIFIED"] })
        expect(Flags.reviewerOf(["OUTSIDE_AREA", "ATTESTATION_UNVERIFIED"])).toBe("PLATFORM")
    })

    it("counts an accepted one and tells its owner; a rejected one doesn't count, with the reason", async () => {
        await Flags.decide(outside, { accept: true }, "a1")
        expect(await status(outside)).toBe("ACCEPTED")
        await Flags.decide(unverified, { accept: false, reason: "Not at work that day" }, "sa")
        expect(await status(unverified)).toBe("REJECTED")
        expect(await notices("e1")).toEqual(["notice_att_checkin_accepted", "notice_att_checkin_rejected"])
        const { rows } = await db.query(`SELECT action, "superAdminId" FROM "AuditLog" WHERE "entityId" = ANY($1) ORDER BY "createdAt"`, [[outside, unverified]])
        expect(rows).toEqual([{ action: "ACCEPT_FLAGGED_CHECK_IN", superAdminId: null }, { action: "REJECT_FLAGGED_CHECK_IN", superAdminId: "sa" }])
    })

    it("is decided once: a second decision is refused, and nobody decides their own", async () => {
        await expect(Flags.decide(outside, { accept: false }, "a1")).rejects.toThrow("CHECK_IN_NOT_FLAGGED")
        attested.verified = true
        const mine = await checkIn("c1", "e1", DOWN_THE_ROAD)
        await expect(Flags.decide(mine, { accept: true }, "e1")).rejects.toThrow("CANNOT_DECIDE_OWN")
        const outcomes = await Promise.allSettled([Flags.decide(mine, { accept: true }, "a1"), Flags.decide(mine, { accept: false }, "sa")])
        expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1)
    })

    it("refuses to decide one in a month whose payroll is approved", async () => {
        attested.verified = true
        const late = await checkIn("c2", "x2", DOWN_THE_ROAD)
        const month = (await db.query(`SELECT to_char("punchAtLocal", 'YYYY-MM') AS m FROM "AttendancePunch" WHERE id = $1`, [late])).rows[0].m as string
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt") VALUES ('run2', 'c2', $1, $2, 'APPROVED', 1, now())`, [Number(month.slice(0, 4)), Number(month.slice(5, 7))])
        await expect(Flags.decide(late, { accept: true }, "a2")).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        expect(await status(late)).toBe("FLAGGED")
    })

    it("shows the Super Admin, per company, what was refused and flagged, and why", async () => {
        attested.verified = true
        await checkIn("c1", "e1", AT_DESK, true)
        await checkIn("c1", "e1", AT_DESK, true)
        const view = await Flags.integrity()
        const one = view.find(r => r.companyId === "c1")!
        expect(one).toMatchObject({ name: "One", refused: 2, refusedBy: { MOCK_LOCATION: 2 } })
        expect(one.flaggedBy).toMatchObject({ ATTESTATION_UNVERIFIED: 1, OUTSIDE_AREA: 2 })
        expect(one.checkIns).toBe(3)
        // Worst first: the company with refusals before the one without.
        expect(view[0].companyId).toBe("c1")
    })
})
