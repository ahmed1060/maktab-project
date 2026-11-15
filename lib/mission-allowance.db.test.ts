import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { STANDARD_OFFICE, type MissionAllowance } from "@/lib/attendance/policy"

/**
 * Each mission day priced, against a real Postgres built from the
 * migrations (ATTENDANCE_PLAN.md §6.10, round 10, decisions 6, 9, 12 and 25,
 * PR 287): the allowance kept on the day, following the approved mission
 * and not the day's scans; by the policy and the salary in force on each
 * date; nothing on leave or suspended; taken back when the mission is
 * cancelled; and a month whose payroll is approved freezing its days with
 * no allowance, since no payslip carries one yet, and keeping them so.
 *
 * The clock is held at 10:00 on Saturday 14 November 2026 in Cairo (+02:00),
 * so days are worked out up to Friday the 13th. The office works Sunday to
 * Thursday, 09:00–17:00, with an hour's break. Ehab and Eman are paid
 * 9,300.00 a month, Ehab 12,000.00 from 10 November; Hessa is suspended on
 * 4 and 5 November. Attendance starts with Eman's scan on 1 October.
 *
 * From 1 October one day of the allowance is worth 200.00, a mission by
 * days paying one for each date and a mission by hours a half; from
 * 8 November one day is the employee's own day's pay, a mission by days
 * paying two and a mission by hours a quarter.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e4', 'e4@x', 'p', 'Hessa', 'Four', 'EMPLOYEE', 2026, 'e4', 'c1', NULL);
`

const NOW = new Date("2026-11-14T08:00:00Z")
const paying = (allowance: MissionAllowance) => ({ ...STANDARD_OFFICE, missions: { enabled: true, allowance } })

describe.skipIf(!ADMIN_URL)("each mission day priced, in Postgres", () => {
    const dbName = `mission_allowance_test_${Date.now()}`
    let db: Client
    let Missions: typeof import("@/lib/services/mission-request.service").MissionRequestService
    let Engine: typeof import("@/lib/services/attendance-engine.service").AttendanceEngineService
    let Policy: typeof import("@/lib/services/attendance-policy.service").AttendancePolicyService

    const day = async (userId: string, date: string) => (await db.query(`SELECT * FROM "AttendanceDay" WHERE "userId" = $1 AND date = $2`, [userId, date])).rows[0]
    /** A date's status, deduction and allowance, as kept. */
    const paid = async (userId: string, date: string) => {
        const d = await day(userId, date)
        return [d.status, d.deductionMinor, d.missionAllowanceMinor]
    }
    const approved = async (userId: string, input: { kind: "DAYS" | "HOURS"; startDate: string; endDate?: string; hoursPart?: "TO_END" | "FROM_START" }) => {
        const m = await Missions.ask("c1", userId, { ...input, reason: "Client visit" })
        await Missions.decide(m.id, { approve: true }, "a1")
        return m.id
    }
    /** Written straight into the table, past what asking refuses: a mission over leave or a suspension. */
    const written = (id: string, userId: string, start: string, end: string) =>
        db.query(`INSERT INTO "MissionRequest"(id, "companyId", "userId", kind, "startDate", "endDate", reason, status) VALUES ($1, 'c1', $2, 'DAYS', $3, $4, 'Client visit', 'APPROVED')`, [id, userId, start, end])

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
        Missions = (await import("@/lib/services/mission-request.service")).MissionRequestService
        Engine = (await import("@/lib/services/attendance-engine.service")).AttendanceEngineService
        Policy = (await import("@/lib/services/attendance-policy.service")).AttendancePolicyService
        const { AttendanceCalendarService: Calendar } = await import("@/lib/services/attendance-calendar.service")
        const { AttendancePunchService: Punches } = await import("@/lib/services/attendance-punch.service")

        // 9,300.00 a month: 300.00 a day in October, 310.00 in November. Ehab's 12,000.00 from the 10th is 400.00 a day.
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
            ('s1', 'e1', 9300, '2026-01-01T00:00:00Z'), ('s1b', 'e1', 12000, '2026-11-09T22:00:00Z'),
            ('s2', 'e2', 9300, '2026-01-01T00:00:00Z'), ('s4', 'e4', 9300, '2026-01-01T00:00:00Z')`)
        // Hessa: suspended for the whole of 4 and 5 November (Cairo, +02:00).
        await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
            ('h4', 'e4', 'HIRED', '2026-01-01T00:00:00Z'), ('u4a', 'e4', 'SUSPENDED', '2026-11-03T22:00:00Z'), ('u4b', 'e4', 'UNSUSPENDED', '2026-11-05T22:00:00Z')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-10-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-10-01", body: paying({ dayWorth: "AMOUNT", amountMinor: 20_000, days: 1, hours: 0.5 }) }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-11-08", body: paying({ dayWorth: "OWN_PAY", amountMinor: 0, days: 2, hours: 0.25 }) }, "a1")
        await Punches.addManual("c1", { userId: "e2", at: "2026-10-01T09:00", direction: null, note: "terminal down" }, "a1")
        await Engine.recomputeFrom("c1", "2026-10-01")
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

    it("keeps the allowance on the day, nothing on a day there before it", async () => {
        const { rows: [column] } = await db.query(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'AttendanceDay' AND column_name = 'missionAllowanceMinor'`)
        expect(column).toEqual({ data_type: "integer", is_nullable: "NO", column_default: "0" })
    })

    it("pays nothing while no mission is approved, one that waits included", async () => {
        const m = await Missions.ask("c1", "e1", { kind: "DAYS", startDate: "2026-11-02", endDate: "2026-11-02", reason: "Client visit" })
        await Engine.recomputeMonth("c1", "2026-11")
        const { rows: [{ days, total }] } = await db.query(`SELECT count(*)::int AS days, coalesce(sum("missionAllowanceMinor"), 0)::int AS total FROM "AttendanceDay" WHERE "companyId" = 'c1'`)
        expect(days).toBeGreaterThan(100)
        expect(total).toBe(0)
        await Missions.withdraw(m.id, "e1")
    })

    it("pays a mission by days for every date in it, rest days included, at the amount typed in (decision 9)", async () => {
        // Thursday 29 to Saturday 31 October: 200.00 a day, 600.00 in all, as the plan's example.
        await approved("e1", { kind: "DAYS", startDate: "2026-10-29", endDate: "2026-10-31" })
        expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 20_000])
        expect(await paid("e1", "2026-10-30")).toEqual(["REST", 0, 20_000])
        expect(await paid("e1", "2026-10-31")).toEqual(["REST", 0, 20_000])
        // The day before it isn't in it.
        expect(await paid("e1", "2026-10-28")).toEqual(["ABSENT", 30_000, 0])
    })

    it("pays a mission by hours once, on its date, following the mission and not the day's scans", async () => {
        // Sunday 1 November, until the end of the day, with no scan: absent, charged, and the allowance still paid.
        await approved("e1", { kind: "HOURS", startDate: "2026-11-01", hoursPart: "TO_END" })
        expect(await paid("e1", "2026-11-01")).toEqual(["ABSENT", 31_000, 10_000])
        expect((await day("e1", "2026-11-01")).breakdown.mission).toBe("TO_END")
    })

    it("takes one day as their own day's pay under the version in force that date, at that date's salary", async () => {
        // Monday 9 and Tuesday 10 November, two days' pay each: 310.00 a day, then 400.00 from the raise.
        await approved("e1", { kind: "DAYS", startDate: "2026-11-09", endDate: "2026-11-10" })
        expect(await paid("e1", "2026-11-09")).toEqual(["MISSION", 0, 62_000])
        expect(await paid("e1", "2026-11-10")).toEqual(["MISSION", 0, 80_000])
        // By hours on the 11th, a quarter of 400.00.
        await approved("e1", { kind: "HOURS", startDate: "2026-11-11", hoursPart: "FROM_START" })
        expect((await day("e1", "2026-11-11")).missionAllowanceMinor).toBe(10_000)
        // The dates before the version are as they were.
        expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 20_000])
    })

    it("is worked out again when the policy changes", async () => {
        // From the 10th: one day worth 150.00, a mission by days paying a half and a mission by hours nothing.
        await Policy.saveVersion("c1", { effectiveFrom: "2026-11-10", body: paying({ dayWorth: "AMOUNT", amountMinor: 15_000, days: 0.5, hours: 0 }) }, "a1")
        expect((await day("e1", "2026-11-09")).missionAllowanceMinor).toBe(62_000)
        expect((await day("e1", "2026-11-10")).missionAllowanceMinor).toBe(7_500)
        expect((await day("e1", "2026-11-11")).missionAllowanceMinor).toBe(0)
    })

    it("is taken back when the mission is cancelled (decision 25)", async () => {
        const { rows: [m] } = await db.query(`SELECT id FROM "MissionRequest" WHERE "userId" = 'e1' AND "startDate" = '2026-11-09'`)
        await Missions.cancel(m.id, "Trip called off", "a1")
        expect(await paid("e1", "2026-11-09")).toEqual(["ABSENT", 31_000, 0])
        expect(await paid("e1", "2026-11-10")).toEqual(["ABSENT", 40_000, 0])
    })

    it("pays nothing on a date on leave, a rest day of the leave included, or suspended", async () => {
        // Eman: a mission from Tuesday 3 to Saturday 7 November, on leave on Thursday the 5th and Friday the 6th.
        await written("w1", "e2", "2026-11-03", "2026-11-07")
        await db.query(`INSERT INTO "DayOffRequest"(id, "userId", type, status, date, "endDate", "updatedAt") VALUES ('l1', 'e2', 'REGULAR', 'APPROVED', '2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z', now())`)
        // Hessa: a mission from Tuesday 3 to Thursday 5 November, suspended on the 4th and 5th.
        await written("w2", "e4", "2026-11-03", "2026-11-05")
        await Engine.recomputeMonth("c1", "2026-11", ["e2", "e4"])
        expect(await paid("e2", "2026-11-03")).toEqual(["MISSION", 0, 20_000])
        expect(await paid("e2", "2026-11-04")).toEqual(["MISSION", 0, 20_000])
        expect(await paid("e2", "2026-11-05")).toEqual(["LEAVE", 0, 0])
        expect(await paid("e2", "2026-11-06")).toEqual(["REST", 0, 0])
        expect(await paid("e2", "2026-11-07")).toEqual(["REST", 0, 20_000])
        expect(await paid("e4", "2026-11-03")).toEqual(["MISSION", 0, 20_000])
        expect(await paid("e4", "2026-11-04")).toEqual(["SUSPENDED", 0, 0])
        expect(await paid("e4", "2026-11-05")).toEqual(["SUSPENDED", 0, 0])
    })

    it("writes a day again only when something of it changed", async () => {
        const before = (await db.query(`SELECT id, "inputsHash", "derivedAt" FROM "AttendanceDay" WHERE "companyId" = 'c1' ORDER BY id`)).rows
        expect((await Engine.recomputeMonth("c1", "2026-11")).written).toBe(0)
        expect((await Engine.recomputeMonth("c1", "2026-10")).written).toBe(0)
        expect((await db.query(`SELECT id, "inputsHash", "derivedAt" FROM "AttendanceDay" WHERE "companyId" = 'c1' ORDER BY id`)).rows).toEqual(before)
        // An allowance that changes with nothing else of the day is a change: the amount, from 200.00 to 250.00.
        await db.query(`UPDATE "AttendancePolicy" SET body = jsonb_set(body, '{missions,allowance,amountMinor}', '25000') WHERE "companyId" = 'c1' AND "effectiveFrom" = '2026-10-01'`)
        expect((await Engine.recomputeMonth("c1", "2026-10")).written).toBe(3)
        expect((await day("e1", "2026-10-30")).missionAllowanceMinor).toBe(25_000)
        await db.query(`UPDATE "AttendancePolicy" SET body = jsonb_set(body, '{missions,allowance,amountMinor}', '20000') WHERE "companyId" = 'c1' AND "effectiveFrom" = '2026-10-01'`)
        expect((await Engine.recomputeMonth("c1", "2026-10")).written).toBe(3)
    })

    it("lists the allowance with the day", async () => {
        const days = await Engine.days("c1", { from: "2026-10-28", to: "2026-10-31", userId: "e1" }, { kind: "COMPANY" })
        expect(days.map(d => [d.date, d.missionAllowanceMinor])).toEqual([["2026-10-31", 20_000], ["2026-10-30", 20_000], ["2026-10-29", 20_000], ["2026-10-28", 0]])
    })

    it("freezes a month's days with no allowance while no payslip carries one, and keeps them so (§12.3)", async () => {
        const { stampDays } = await import("@/lib/services/attendance-payroll")
        const { prisma } = await import("@/lib/prisma")
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "attendanceIncluded", "updatedAt") VALUES ('run10', 'c1', 2026, 10, 'APPROVED', 25, true, now())`)
        // Approval stamps the month's days with the run that paid them. Paying the allowance is the next PR's,
        // so what a frozen day holds is what its payslip paid: none. November's days are left as they are.
        expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 20_000])
        const stamped = await prisma.$transaction(tx => stampDays(tx, "c1", 2026, 10, "run10"))
        expect(stamped).toBeGreaterThan(60)
        expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 0])
        expect(await paid("e1", "2026-10-30")).toEqual(["REST", 0, 0])
        expect(await paid("e1", "2026-10-28")).toEqual(["ABSENT", 30_000, 0])
        expect((await day("e1", "2026-10-29")).lockedByPayrollRunId).toBe("run10")
        expect(await paid("e2", "2026-11-03")).toEqual(["MISSION", 0, 20_000])
        // Worked out again, the frozen days stay as paid: a mission approved over a day paid as absent,
        // and the paid mission cancelled.
        await approved("e1", { kind: "DAYS", startDate: "2026-10-28", endDate: "2026-10-28" })
        expect(await paid("e1", "2026-10-28")).toEqual(["ABSENT", 30_000, 0])
        const { rows: [m] } = await db.query(`SELECT id FROM "MissionRequest" WHERE "userId" = 'e1' AND "startDate" = '2026-10-29'`)
        await Missions.cancel(m.id, "Trip called off", "a1")
        expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 0])
        // Stamped again by a later approval, days already frozen aren't touched.
        expect(await prisma.$transaction(tx => stampDays(tx, "c1", 2026, 10, "run10"))).toBe(0)
    })
})
