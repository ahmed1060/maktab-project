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
 * cancelled; and paid with salary (PR 288): what the dry run says it would
 * add, the payslip's line and the entry written at approval, and the days
 * frozen with what was paid; and across a closed month (PR 289): the
 * difference that carries the allowance, for those the run paid.
 *
 * The clock is held at 10:00 on Saturday 14 November 2026 in Cairo (+02:00),
 * so days are worked out up to Friday the 13th. The office works Sunday to
 * Thursday, 09:00–17:00, with an hour's break. Ehab and Eman are paid
 * 9,300.00 a month, Ehab 12,000.00 from 10 November; Hessa is suspended on
 * 4 and 5 November. Nour has no employment on record, so no payroll run
 * holds a payslip of theirs. Attendance starts with Eman's scans on
 * 1 October.
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
 ('e4', 'e4@x', 'p', 'Hessa', 'Four', 'EMPLOYEE', 2026, 'e4', 'c1', NULL),
 ('e5', 'e5@x', 'p', 'Nour', 'Five', 'EMPLOYEE', 2026, 'e5', 'c1', NULL);
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
            ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z'), ('h2', 'e2', 'HIRED', '2026-01-01T00:00:00Z'),
            ('h4', 'e4', 'HIRED', '2026-01-01T00:00:00Z'), ('u4a', 'e4', 'SUSPENDED', '2026-11-03T22:00:00Z'), ('u4b', 'e4', 'UNSUSPENDED', '2026-11-05T22:00:00Z')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-10-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-10-01", body: paying({ dayWorth: "AMOUNT", amountMinor: 20_000, days: 1, hours: 0.5 }) }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-11-08", body: paying({ dayWorth: "OWN_PAY", amountMinor: 0, days: 2, hours: 0.25 }) }, "a1")
        // A whole day, so nothing of October waits to be settled before its payroll.
        await Punches.addManual("c1", { userId: "e2", at: "2026-10-01T09:00", direction: null, note: "terminal down" }, "a1")
        await Punches.addManual("c1", { userId: "e2", at: "2026-10-01T17:00", direction: null, note: "terminal down" }, "a1")
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

    describe("paid with salary (PR 288)", () => {
        let Payroll: typeof import("@/lib/services/payroll-run.service").PayrollRunService
        const SESSION = { user: { id: "a1", role: "ADMIN" } }
        const ehab = (register: { entries: { userId: string; lines: { kind: string; label: string; amountMinor: number; source: string; sourceId?: string | null }[]; totals: { netMinor: number } }[] }) =>
            register.entries.find(e => e.userId === "e1")!
        const attendanceLines = (lines: { kind: string; label: string; amountMinor: number; source: string; sourceId?: string | null }[]) =>
            lines.filter(l => l.source === "ATTENDANCE").map(l => [l.kind, l.label, l.sourceId, l.amountMinor])
        let runId: string

        beforeAll(async () => {
            Payroll = (await import("@/lib/services/payroll-run.service")).PayrollRunService
        })

        it("says in the dry run what the allowance would add, and pays nobody, before attendance reaches payroll", async () => {
            const out = await Payroll.compute("c1", 2026, 10)
            expect(out.attendance).toMatchObject({ reachesPayroll: false, from: null })
            // Thursday 29 to Saturday 31 October at 200.00 a day.
            expect(out.attendance.byPerson.e1.missionAllowance).toBe(60_000)
            expect(out.attendance.byPerson.e2.missionAllowance).toBe(0)
            expect(attendanceLines(ehab(out.register).lines)).toEqual([])
            expect(ehab(out.register).totals.netMinor).toBe(930_000)
        })

        it("from the month attendance reaches payroll, is an earning on the payslip, after overtime and before the deductions", async () => {
            await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = '2026-10-01' WHERE id = 'c1'`)
            const out = await Payroll.compute("c1", 2026, 10)
            expect(out.attendance.reachesPayroll).toBe(true)
            const lines = attendanceLines(ehab(out.register).lines)
            expect(lines[0]).toEqual(["EARNING", "Mission allowance", "MISSION_ALLOWANCE", 60_000])
            expect(lines.slice(1).map(l => [l[0], l[1]])).toEqual([["DEDUCTION", "Absence"]])
            // The salary, the allowance, less the absences: nothing else moves the net.
            const absence = lines[1][3] as number
            expect(absence).toBeGreaterThan(0)
            expect(ehab(out.register).totals.netMinor).toBe(930_000 + 60_000 - absence)
        })

        it("is written at approval as its own entry, on the payslip's own line, and the days are frozen with what was paid", async () => {
            // Nour's mission is priced like anyone's, and the run, which has no payslip of theirs, pays none of it.
            await approved("e5", { kind: "DAYS", startDate: "2026-10-20", endDate: "2026-10-20" })
            expect(await paid("e5", "2026-10-20")).toEqual(["MISSION", 0, 20_000])
            const result = await Payroll.approve("c1", 2026, 10, SESSION)
            expect(result).toHaveProperty("runId")
            runId = (result as { runId: string }).runId
            const { rows: entries } = await db.query(`SELECT category, "amountMinor", "payrollRunId" FROM "AttendancePayrollEntry" WHERE "userId" = 'e1' AND category = 'MISSION_ALLOWANCE'`)
            expect(entries).toEqual([{ category: "MISSION_ALLOWANCE", amountMinor: 60_000, payrollRunId: runId }])
            const { rows: lines } = await db.query(`SELECT l.kind, l.label, l.amount::text, l."sourceId" FROM "PayslipLine" l JOIN "Payslip" p ON p.id = l."payslipId" WHERE p."userId" = 'e1' AND l.source = 'ATTENDANCE' AND l.kind = 'EARNING'`)
            expect(lines).toEqual([{ kind: "EARNING", label: "Mission allowance", amount: "600.00", sourceId: "MISSION_ALLOWANCE" }])
            // Nobody else the run paid had a mission in October, so nobody else has the entry.
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePayrollEntry" WHERE category = 'MISSION_ALLOWANCE'`)).rows[0].n).toBe(1)
            expect((await db.query(`SELECT count(*)::int AS n FROM "Payslip" WHERE "userId" = 'e5'`)).rows[0].n).toBe(0)
            expect(await paid("e5", "2026-10-20")).toEqual(["MISSION", 0, 0])
            // Frozen as paid: the mission's days keep their allowance, where PR 287 froze them with none.
            expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 20_000])
            expect(await paid("e1", "2026-10-30")).toEqual(["REST", 0, 20_000])
            expect(await paid("e1", "2026-10-31")).toEqual(["REST", 0, 20_000])
            expect((await day("e1", "2026-10-29")).lockedByPayrollRunId).toBe(runId)
            // November, not approved, is as it was.
            expect(await paid("e2", "2026-11-03")).toEqual(["MISSION", 0, 20_000])
            expect((await day("e2", "2026-11-03")).lockedByPayrollRunId).toBeNull()
        })

        it("is reconciled, never appended: written again it changes nothing, and gone it is removed (§12.2)", async () => {
            const { reconcileEntries } = await import("@/lib/services/attendance-payroll")
            const { prisma } = await import("@/lib/prisma")
            const { rows } = await db.query(`SELECT category, "amountMinor" FROM "AttendancePayrollEntry" WHERE "userId" = 'e1'`)
            const of = (category: string) => rows.find(r => r.category === category)?.amountMinor ?? 0
            const attendance = { lateness: of("LATENESS"), earlyLeave: of("EARLY_LEAVE"), absence: of("ABSENCE"), overtime: of("OVERTIME"), missionAllowance: of("MISSION_ALLOWANCE") }
            const others = (await db.query(`SELECT DISTINCT "userId" FROM "AttendancePayrollEntry" WHERE "userId" <> 'e1'`)).rows
            const kept = await Promise.all(others.map(async o => {
                const { rows: theirs } = await db.query(`SELECT category, "amountMinor" FROM "AttendancePayrollEntry" WHERE "userId" = $1`, [o.userId])
                const get = (category: string) => theirs.find(r => r.category === category)?.amountMinor ?? 0
                return { userId: o.userId as string, excluded: false, attendance: { lateness: get("LATENESS"), earlyLeave: get("EARLY_LEAVE"), absence: get("ABSENCE"), overtime: get("OVERTIME"), missionAllowance: get("MISSION_ALLOWANCE") } }
            }))
            const same = [{ userId: "e1", excluded: false, attendance }, ...kept]
            expect(await prisma.$transaction(tx => reconcileEntries(tx, "c1", 2026, 10, runId, same))).toEqual({ written: 0, removed: 0 })
            const less = [{ userId: "e1", excluded: false, attendance: { ...attendance, missionAllowance: 0 } }, ...kept]
            expect(await prisma.$transaction(tx => reconcileEntries(tx, "c1", 2026, 10, runId, less))).toEqual({ written: 0, removed: 1 })
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePayrollEntry" WHERE category = 'MISSION_ALLOWANCE'`)).rows[0].n).toBe(0)
            // Put back as approved.
            expect(await prisma.$transaction(tx => reconcileEntries(tx, "c1", 2026, 10, runId, same))).toEqual({ written: 1, removed: 0 })
        })

        it("keeps the paid month as it was paid when a mission is approved or cancelled after it (§12.3)", async () => {
            // A mission approved over a day paid as absent: the day stays as paid, with no allowance on it.
            await approved("e1", { kind: "DAYS", startDate: "2026-10-28", endDate: "2026-10-28" })
            expect(await paid("e1", "2026-10-28")).toEqual(["ABSENT", 30_000, 0])
            // The paid mission cancelled: its days keep the allowance they were paid with, and so does the entry.
            const { rows: [m] } = await db.query(`SELECT id FROM "MissionRequest" WHERE "userId" = 'e1' AND "startDate" = '2026-10-29'`)
            await Missions.cancel(m.id, "Trip called off", "a1")
            expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 20_000])
            expect(await paid("e1", "2026-10-30")).toEqual(["REST", 0, 20_000])
            expect((await db.query(`SELECT "amountMinor" FROM "AttendancePayrollEntry" WHERE "userId" = 'e1' AND category = 'MISSION_ALLOWANCE'`)).rows).toEqual([{ amountMinor: 60_000 }])
        })

        /** November's days that hold an allowance, by person, as a transaction sees them. */
        const held = async (tx: { attendanceDay: { findMany: (args: object) => Promise<{ userId: string; missionAllowanceMinor: number }[]> } }) => {
            const days = await tx.attendanceDay.findMany({
                where: { companyId: "c1", date: { gte: new Date("2026-11-01T00:00:00Z"), lt: new Date("2026-12-01T00:00:00Z") }, missionAllowanceMinor: { gt: 0 } },
                select: { userId: true, missionAllowanceMinor: true },
            })
            const by: Record<string, number> = {}
            for (const d of days) by[d.userId] = (by[d.userId] ?? 0) + d.missionAllowanceMinor
            return by
        }

        it("freezes a day with its allowance only for those whose payslips carried one (review on PR 288)", async () => {
            const { stampDays } = await import("@/lib/services/attendance-payroll")
            const { prisma } = await import("@/lib/prisma")
            // November as it stands: Ehab's mission by hours on the 1st, Eman's days, Hessa's one day.
            expect(await held(prisma)).toEqual({ e1: 10_000, e2: 60_000, e4: 20_000 })
            // Frozen with only Eman paid: hers stay, the others' are cleared. Undone after, to leave November open.
            let after: Record<string, number> = {}
            await expect(prisma.$transaction(async tx => {
                expect(await stampDays(tx, "c1", 2026, 11, runId, ["e2"])).toBeGreaterThan(30)
                after = await held(tx)
                throw new Error("UNDO")
            })).rejects.toThrow("UNDO")
            expect(after).toEqual({ e2: 60_000 })
            // And with nobody paid, none stays.
            await expect(prisma.$transaction(async tx => {
                await stampDays(tx, "c1", 2026, 11, runId, [])
                after = await held(tx)
                throw new Error("UNDO")
            })).rejects.toThrow("UNDO")
            expect(after).toEqual({})
            expect(await held(prisma)).toEqual({ e1: 10_000, e2: 60_000, e4: 20_000 })
            // October's days, frozen already, were never touched.
            expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 20_000])
        })

        it("freezes a month approved before attendance reaches payroll with no allowance: nothing paid it (review on PR 288)", async () => {
            // Attendance reaches payroll from December, so November's is a dry run.
            await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = '2026-12-01' WHERE id = 'c1'`)
            const dry = await Payroll.compute("c1", 2026, 11)
            expect(dry.attendance.reachesPayroll).toBe(false)
            expect(dry.attendance.byPerson.e2.missionAllowance).toBe(60_000)
            const result = await Payroll.approve("c1", 2026, 11, SESSION, { acknowledgePending: true })
            expect(result).toHaveProperty("runId")
            const november = (result as { runId: string }).runId
            expect((await db.query(`SELECT status, "attendanceIncluded" FROM "PayrollRun" WHERE id = $1`, [november])).rows[0]).toEqual({ status: "APPROVED", attendanceIncluded: false })
            // No payslip carried it, and no entry was written.
            expect((await db.query(`SELECT count(*)::int AS n FROM "PayslipLine" l JOIN "Payslip" p ON p.id = l."payslipId" WHERE p."payrollRunId" = $1 AND l.source = 'ATTENDANCE'`, [november])).rows[0].n).toBe(0)
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendancePayrollEntry" WHERE year = 2026 AND month = 11`)).rows[0].n).toBe(0)
            // So the days are frozen with none, still reading as the missions they were.
            expect(await paid("e2", "2026-11-03")).toEqual(["MISSION", 0, 0])
            expect(await paid("e2", "2026-11-07")).toEqual(["REST", 0, 0])
            expect(await paid("e4", "2026-11-03")).toEqual(["MISSION", 0, 0])
            expect((await day("e2", "2026-11-03")).lockedByPayrollRunId).toBe(november)
            const { rows: [left] } = await db.query(`SELECT coalesce(sum("missionAllowanceMinor"), 0)::int AS total FROM "AttendanceDay" WHERE "companyId" = 'c1' AND date >= '2026-11-01'`)
            expect(left.total).toBe(0)
            // The approved month's register, read again, says nothing of an allowance either.
            const after = await Payroll.compute("c1", 2026, 11)
            expect(Object.values(after.attendance.byPerson).reduce((s, m) => s + m.missionAllowance, 0)).toBe(0)
            // October, paid with attendance, keeps what its payslips carried.
            expect(await paid("e1", "2026-10-29")).toEqual(["MISSION", 0, 20_000])
        })
    })

    /**
     * October's payroll is approved, with attendance on its payslips. Since
     * then a mission of Ehab's was approved over the 28th, paid as absent,
     * and the one paid for, the 29th to the 31st, was cancelled.
     */
    describe("across a closed month (PR 289)", () => {
        let Discrepancies: typeof import("@/lib/services/attendance-discrepancy.service").AttendanceDiscrepancyService
        const open = async (userId: string) => (await Discrepancies.list("c1")).open.filter(d => d.userId === userId).sort((a, b) => a.date.localeCompare(b.date))
        const on = async (userId: string, date: string) => (await open(userId)).find(d => d.date === date)

        beforeAll(async () => {
            Discrepancies = (await import("@/lib/services/attendance-discrepancy.service")).AttendanceDiscrepancyService
        })

        it("keeps what the allowance was paid at and what it is now on the difference, empty where it wasn't recorded", async () => {
            const { rows } = await db.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'AttendanceDiscrepancy' AND column_name LIKE '%AllowanceMinor' ORDER BY column_name`)
            expect(rows).toEqual([
                { column_name: "nowAllowanceMinor", data_type: "integer", is_nullable: "YES", column_default: null },
                { column_name: "paidAllowanceMinor", data_type: "integer", is_nullable: "YES", column_default: null },
            ])
        })

        it("owes the allowance of a mission approved after its month was paid, with the absence it was charged (decision 16)", async () => {
            expect(await on("e1", "2026-10-28")).toMatchObject({
                paidStatus: "ABSENT", nowStatus: "MISSION",
                paidDeductionMinor: 30_000, nowDeductionMinor: 0,
                paidAllowanceMinor: 0, nowAllowanceMinor: 20_000,
                // 300.00 of absence to give back and 200.00 of allowance never paid.
                allowanceMinor: 20_000, differenceMinor: 50_000,
            })
        })

        it("takes back the allowance of a paid mission cancelled, on its rest days too, where nothing else changed (decision 25)", async () => {
            expect(await on("e1", "2026-10-29")).toMatchObject({
                paidStatus: "MISSION", nowStatus: "ABSENT",
                paidAllowanceMinor: 20_000, nowAllowanceMinor: 0,
                // 200.00 of allowance and 300.00 of absence, both owed by them.
                allowanceMinor: -20_000, differenceMinor: -50_000,
            })
            for (const date of ["2026-10-30", "2026-10-31"]) {
                expect(await on("e1", date), date).toMatchObject({
                    paidStatus: "REST", nowStatus: "REST", paidDeductionMinor: 0, nowDeductionMinor: 0,
                    paidAllowanceMinor: 20_000, nowAllowanceMinor: 0, allowanceMinor: -20_000, differenceMinor: -20_000,
                })
            }
            expect((await open("e1")).map(d => d.date)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"])
            // The paid days themselves are as they were paid.
            expect(await paid("e1", "2026-10-30")).toEqual(["REST", 0, 20_000])
            expect(await paid("e1", "2026-10-28")).toEqual(["ABSENT", 30_000, 0])
        })

        it("compares nothing of the allowance for someone the run didn't pay, and lists no day that didn't change", async () => {
            // Nour's mission stands, and would pay 200.00: the run paid none of it, which is no change since.
            expect((await db.query(`SELECT status FROM "MissionRequest" WHERE "userId" = 'e5'`)).rows).toEqual([{ status: "APPROVED" }])
            // The whole month worked out again, as the nightly run does.
            expect(await Engine.recomputeMonth("c1", "2026-10")).toMatchObject({ locked: true, discrepancies: 4 })
            expect(await open("e5")).toEqual([])
            expect(await open("e2")).toEqual([])
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendanceDiscrepancy"`)).rows[0].n).toBe(4)
        })

        it("closes a difference when the day comes back to what was paid", async () => {
            // The trip is on again: the 29th to the 31st read and pay as they were paid.
            await approved("e1", { kind: "DAYS", startDate: "2026-10-29", endDate: "2026-10-31" })
            expect((await open("e1")).map(d => d.date)).toEqual(["2026-10-28"])
        })

        it("measures a day that changes again from what was last settled, the settled difference kept as it was", async () => {
            const settled = (await on("e1", "2026-10-28"))!
            await Discrepancies.resolve(settled.id, "Paid with November's salary", "a1", false)
            // The mission over the 28th cancelled: the allowance and the absence settled are owed back.
            const { rows: [m] } = await db.query(`SELECT id FROM "MissionRequest" WHERE "userId" = 'e1' AND "startDate" = '2026-10-28' AND status = 'APPROVED'`)
            await Missions.cancel(m.id, "Visit called off", "a1")
            expect(await on("e1", "2026-10-28")).toMatchObject({
                paidStatus: "MISSION", nowStatus: "ABSENT",
                paidDeductionMinor: 0, nowDeductionMinor: 30_000,
                paidAllowanceMinor: 20_000, nowAllowanceMinor: 0, differenceMinor: -50_000,
            })
            const { rows: [kept] } = await db.query(`SELECT "paidAllowanceMinor", "nowAllowanceMinor", resolution FROM "AttendanceDiscrepancy" WHERE id = $1`, [settled.id])
            expect(kept).toEqual({ paidAllowanceMinor: 0, nowAllowanceMinor: 20_000, resolution: "Paid with November's salary" })
        })

        it("reads what was paid from the day for a difference recorded before the allowance was carried", async () => {
            // The paid mission cancelled again, and its first day's difference left as the code before recorded it: no allowance on it.
            const { rows: [m] } = await db.query(`SELECT id FROM "MissionRequest" WHERE "userId" = 'e1' AND "startDate" = '2026-10-29' AND status = 'APPROVED'`)
            await Missions.cancel(m.id, "Trip called off again", "a1")
            await db.query(`UPDATE "AttendanceDiscrepancy" SET "paidAllowanceMinor" = NULL, "nowAllowanceMinor" = NULL WHERE "userId" = 'e1' AND date = '2026-10-29' AND "resolvedAt" IS NULL`)
            expect(await on("e1", "2026-10-29")).toMatchObject({ paidAllowanceMinor: null, nowAllowanceMinor: null, allowanceMinor: 0, differenceMinor: -30_000 })
            // Worked out again, it carries the allowance the day was paid with.
            await Engine.recomputeMonth("c1", "2026-10", ["e1"])
            expect(await on("e1", "2026-10-29")).toMatchObject({ paidAllowanceMinor: 20_000, nowAllowanceMinor: 0, allowanceMinor: -20_000, differenceMinor: -50_000 })
        })
    })
})
