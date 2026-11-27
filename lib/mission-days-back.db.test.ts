import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * How far back a mission may be asked for, against a real Postgres built
 * from the migrations (LATER_CHANGES_PLAN.md §7.4, 4c).
 *
 * The clock is held at 10:00 on Friday 27 November 2026 in Cairo. One's
 * policy says 3 days back, and from 1 December 30; Two's was saved before
 * days back existed, so 7, and its November payroll is approved; Three has
 * no policy, so 7 too.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now()), ('c3', 'Three', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2'),
 ('e3', 'e3@x', 'p', 'Essam', 'Three', 'EMPLOYEE', 2026, 'e3', 'c3');
`

const NOW = new Date("2026-11-27T08:00:00Z")
const byDays = (startDate: string, endDate = startDate) => ({ kind: "DAYS" as const, startDate, endDate, reason: "Client visit" })

describe.skipIf(!ADMIN_URL)("how far back a mission may be asked for, in Postgres", () => {
    const dbName = `mission_days_back_test_${Date.now()}`
    let db: Client
    let Missions: typeof import("@/lib/services/mission-request.service")
    const policy = (id: string, companyId: string, from: string, body: object) =>
        db.query(`INSERT INTO "AttendancePolicy"(id, "companyId", "effectiveFrom", body, "createdById") VALUES ($1, $2, $3, $4, 'e1')`, [id, companyId, from, JSON.stringify(body)])
    const asked = async (userId: string) => (await db.query(`SELECT to_char("startDate", 'YYYY-MM-DD') AS d FROM "MissionRequest" WHERE "userId" = $1 ORDER BY "startDate"`, [userId])).rows.map(r => r.d)

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
        Missions = await import("@/lib/services/mission-request.service")

        const back = (daysBack: number) => ({ ...STANDARD_OFFICE, missions: { ...STANDARD_OFFICE.missions, daysBack } })
        await policy("p1", "c1", "2026-10-01", back(3))
        // From 1 December, 30: not yet in force.
        await policy("p1b", "c1", "2026-12-01", back(30))
        // Saved before days back existed.
        await policy("p2", "c2", "2026-10-01", { ...STANDARD_OFFICE, missions: { enabled: true } })
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "periodStart", "periodEnd", "updatedAt") VALUES
            ('r11', 'c2', 11, 2026, 'APPROVED', 1, '2026-11-01', '2026-11-30', now())`)
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    it("run from today less the policy in force today's days back, 7 where it says none or there's none, to a year ahead", async () => {
        const { MissionRequestService } = Missions
        expect(await MissionRequestService.window("c1")).toEqual({ from: "2026-11-24", to: "2027-11-27" })
        expect(await MissionRequestService.window("c2")).toEqual({ from: "2026-11-20", to: "2027-11-27" })
        expect(await MissionRequestService.window("c3")).toEqual({ from: "2026-11-20", to: "2027-11-27" })
    })

    it("refuse a date before them or after them, saying which, and take one inside, at either end", async () => {
        const { MissionRequestService, MissionOutOfRange } = Missions
        const early = MissionRequestService.ask("c1", "e1", byDays("2026-11-23", "2026-11-24"))
        await expect(early).rejects.toBeInstanceOf(MissionOutOfRange)
        await expect(early).rejects.toMatchObject({ message: "MISSION_OUT_OF_RANGE", from: "2026-11-24", to: "2027-11-27" })
        await expect(MissionRequestService.ask("c1", "e1", byDays("2027-11-27", "2027-11-28"))).rejects.toMatchObject({ message: "MISSION_OUT_OF_RANGE", from: "2026-11-24" })
        await MissionRequestService.ask("c1", "e1", { kind: "HOURS", startDate: "2026-11-24", hoursPart: "TO_END", reason: "Bank" })
        await MissionRequestService.ask("c1", "e1", byDays("2027-11-27"))
        expect(await asked("e1")).toEqual(["2026-11-24", "2027-11-27"])
    })

    it("are 7 back where the policy was saved before them, a month whose payroll is approved being no refusal, as before", async () => {
        const { MissionRequestService } = Missions
        await expect(MissionRequestService.ask("c2", "e2", byDays("2026-11-19"))).rejects.toMatchObject({ message: "MISSION_OUT_OF_RANGE", from: "2026-11-20" })
        // November's payroll is approved: still asked for (ATTENDANCE_PLAN.md §6.10, decision 16).
        await MissionRequestService.ask("c2", "e2", byDays("2026-11-20", "2026-11-21"))
        expect(await asked("e2")).toEqual(["2026-11-20"])
    })

    it("are 7 back without a policy, missions being on there", async () => {
        const { MissionRequestService } = Missions
        await expect(MissionRequestService.ask("c3", "e3", byDays("2026-11-19"))).rejects.toMatchObject({ message: "MISSION_OUT_OF_RANGE" })
        await MissionRequestService.ask("c3", "e3", byDays("2026-11-20"))
        expect(await asked("e3")).toEqual(["2026-11-20"])
    })
})
