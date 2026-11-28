import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * How far back a request may be asked for (LATER_CHANGES_PLAN.md §7.20;
 * DESIGN.md §5.5): day off, permission hours, a mission and a missing punch
 * alike, from the first day of the payroll month today is in, or of last
 * month's until last month's payroll is approved, never in an approved month,
 * and never before the company's first policy once it's in force. Against a
 * real Postgres built from the migrations, with made-up companies: One, whose
 * payroll closes on the month's last day unless a test says otherwise, its
 * policy any day from 1 October; Two, its first policy from 1 November;
 * Three, its first from 1 December, not yet in force. The clock is 10:00 on
 * 28 November 2026 in Cairo, unless a test moves it.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now()), ('c3', 'Three', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1');
`

const NOW = new Date("2026-11-28T08:00:00Z")

describe.skipIf(!ADMIN_URL)("how far back a request may be asked for, in Postgres", () => {
    const dbName = `request_days_test_${Date.now()}`
    let db: Client
    let Basis: typeof import("@/lib/services/request-days")
    const run = (month: number, status: string, from: string | null = null, to: string | null = null, year = 2026) =>
        db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "periodStart", "periodEnd", "updatedAt") VALUES ($1, 'c1', $2, $3, $4, 1, $5, $6, now())`,
            [`r${year}-${month}`, month, year, status, from, to])
    const from = async (companyId = "c1") => (await Basis.requestDaysBasis(companyId)).from
    const octoberApproved = () => run(10, "APPROVED", "2026-10-01", "2026-10-31")

    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: NOW })
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
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Basis = await import("@/lib/services/request-days")
        await db.query(`INSERT INTO "AttendancePolicy"(id, "companyId", "effectiveFrom", body, "createdById") VALUES ('p1', 'c1', '2026-10-01', $1, 'e1')`,
            [JSON.stringify({ ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, when: "ANY_DAY" } })])
        await db.query(`INSERT INTO "AttendancePolicy"(id, "companyId", "effectiveFrom", body, "createdById") VALUES
            ('p2', 'c2', '2026-11-01', $1, 'e1'), ('p3', 'c3', '2026-12-01', $1, 'e1')`, [JSON.stringify(STANDARD_OFFICE)])
    }, 180_000)

    afterEach(async () => {
        vi.setSystemTime(NOW)
        await db.query(`DELETE FROM "PayrollRun" WHERE "companyId" = 'c1'`)
        await db.query(`DELETE FROM "MissingPunchRequest" WHERE "companyId" = 'c1'`)
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
    })

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    it("is last month's first day until last month's payroll is approved, its draft saved or not", async () => {
        expect(await from()).toBe("2026-10-01")
        await run(10, "DRAFT")
        expect(await from()).toBe("2026-10-01")
    })

    it("is the payroll month's first day once last month's is approved or paid", async () => {
        await octoberApproved()
        expect(await from()).toBe("2026-11-01")
        await db.query(`UPDATE "PayrollRun" SET status = 'PAID' WHERE id = 'r2026-10'`)
        expect(await from()).toBe("2026-11-01")
    })

    it("keeps last month open into the new month, before anyone opens its payroll, until it's approved", async () => {
        await octoberApproved()
        vi.setSystemTime(new Date("2026-12-01T08:00:00Z"))
        // On the 1st, a punch missed on 30 November can still be reported.
        expect(await from()).toBe("2026-11-01")
        await run(11, "DRAFT")
        expect(await from()).toBe("2026-11-01")
        await db.query(`UPDATE "PayrollRun" SET status = 'APPROVED', "periodStart" = '2026-11-01', "periodEnd" = '2026-11-30' WHERE id = 'r2026-11'`)
        expect(await from()).toBe("2026-12-01")
    })

    it("follows when payroll closes", async () => {
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        // The 28th is past November's close: in December's payroll month, with November's, from 25 October, still open.
        expect(await from()).toBe("2026-10-25")
        // November's approved: from the 25th.
        await run(11, "APPROVED", "2026-10-25", "2026-11-24")
        expect(await from()).toBe("2026-11-25")
    })

    it("is never before the company's first policy once it's in force", async () => {
        // Two's first is from 1 November: October has no payroll, but nothing was asked of anyone then.
        expect(await from("c2")).toBe("2026-11-01")
        // Three's isn't in force yet: last month's first day, as with none.
        expect(await from("c3")).toBe("2026-10-01")
    })

    it("is where a day off, permission hours any day and a mission start, each with its own ahead", async () => {
        const { DayOffService } = await import("@/lib/services/day-off.service")
        const { AttendanceRequestService } = await import("@/lib/services/attendance-request.service")
        const { MissionRequestService } = await import("@/lib/services/mission-request.service")
        await octoberApproved()
        expect(await DayOffService.window("c1")).toEqual({ from: "2026-11-01", to: "2026-12-28" })
        expect(await AttendanceRequestService.permissionDays("c1")).toEqual({ from: "2026-11-01", to: "2026-12-28" })
        expect(await MissionRequestService.window("c1")).toEqual({ from: "2026-11-01", to: "2027-11-28" })
        await db.query(`UPDATE "PayrollRun" SET status = 'DRAFT', "periodStart" = NULL, "periodEnd" = NULL WHERE id = 'r2026-10'`)
        expect((await DayOffService.window("c1")).from).toBe("2026-10-01")
        expect((await AttendanceRequestService.permissionDays("c1"))?.from).toBe("2026-10-01")
        expect((await MissionRequestService.window("c1")).from).toBe("2026-10-01")
    })

    it("is where a missing punch may be reported from, and a punch before it is refused, saying the days", async () => {
        const { AttendanceRequestService, MissingPunchOutOfRange } = await import("@/lib/services/attendance-request.service")
        await octoberApproved()
        expect(await AttendanceRequestService.requestDays("c1")).toEqual({ from: "2026-11-01", today: "2026-11-28" })
        const before = AttendanceRequestService.reportMissingPunch("c1", "e1", { at: "2026-10-31T17:00", direction: "OUT", reason: "Forgot" })
        await expect(before).rejects.toBeInstanceOf(MissingPunchOutOfRange)
        await expect(before).rejects.toMatchObject({ message: "MISSING_PUNCH_OUT_OF_RANGE", from: "2026-11-01", to: "2026-11-28" })
        await AttendanceRequestService.reportMissingPunch("c1", "e1", { at: "2026-11-01T17:00", direction: "OUT", reason: "Forgot" })
    })
})
