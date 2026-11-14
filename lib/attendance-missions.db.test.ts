import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { AttendanceExceptionService as Exceptions } from "@/lib/services/attendance-exception.service"
import { AttendanceCheckInService as CheckIn } from "@/lib/services/attendance-check-in.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * A mission's day against a real Postgres built from the migrations
 * (ATTENDANCE_PLAN.md §6.10, round 10, decisions 9, 15, 17 and 23, PR 281):
 * the table that holds missions and what it refuses; the engine reading
 * approved missions, and only those; and the reminder and the day notices
 * keeping quiet on a mission day. Nothing asks for a mission yet, so the
 * missions here are written straight into the table.
 *
 * The clock is held at 09:00 on Saturday 10 October 2026 in Cairo (+03:00),
 * so days are worked out up to the 9th. The office works Sunday to
 * Thursday, 09:00–17:00, with an hour's break; 6 October is a holiday.
 */

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

const NOW = new Date("2026-10-10T06:00:00Z")
const ALL = { kind: "COMPANY" } as const
const NONE = { permissions: null, missing: null, unmatched: false }

describe.skipIf(!ADMIN_URL)("a mission's day, in Postgres", () => {
    const dbName = `missions_test_${Date.now()}`
    let db: Client

    const mission = (id: string, userId: string, kind: "DAYS" | "HOURS", start: string, end: string, part: "FROM_START" | "TO_END" | null, status: string) =>
        db.query(`INSERT INTO "MissionRequest"(id, "companyId", "userId", kind, "startDate", "endDate", "hoursPart", reason, status)
            VALUES ($1, 'c1', $2, $3, $4, $5, $6, 'Client visit', $7)`, [id, userId, kind, start, end, part, status])

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
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()

        // 9,300.00 a month: 300.00 a day in October.
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s1', 'e1', 9300, '2026-01-01T00:00:00Z'), ('s2', 'e2', 9300, '2026-01-01T00:00:00Z')`)
        // Approved: by days from the last week of September into October, and on the holiday;
        // from the start of the day on the 7th; until the end of the day on the 8th.
        await mission("m1", "e1", "DAYS", "2026-09-28", "2026-10-04", null, "APPROVED")
        await mission("m2", "e1", "DAYS", "2026-10-06", "2026-10-06", null, "APPROVED")
        await mission("m3", "e1", "HOURS", "2026-10-07", "2026-10-07", "FROM_START", "APPROVED")
        await mission("m4", "e1", "HOURS", "2026-10-08", "2026-10-08", "TO_END", "APPROVED")
        // Not approved, so counting for nothing.
        await mission("n1", "e2", "DAYS", "2026-10-04", "2026-10-04", null, "PENDING")
        await mission("n2", "e2", "DAYS", "2026-10-05", "2026-10-05", null, "REJECTED")
        await mission("n3", "e2", "HOURS", "2026-10-07", "2026-10-07", "TO_END", "WITHDRAWN")
        await mission("n4", "e2", "DAYS", "2026-10-08", "2026-10-08", null, "CANCELLED")
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-10-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-10-01", body: STANDARD_OFFICE }, "a1")
        for (const [userId, at] of [
            ["e1", "2026-10-01T09:00"], ["e1", "2026-10-01T17:00"],
            ["e1", "2026-10-04T10:30"], ["e1", "2026-10-04T12:00"], // late in, early out, on a mission by days
            ["e1", "2026-10-05T10:30"], ["e1", "2026-10-05T12:00"], // the same, on no mission: it waits
            ["e1", "2026-10-07T12:00"], // one scan, read as the departure
            ["e1", "2026-10-08T09:40"], // one scan, read as the arrival
            ["e2", "2026-10-01T09:00"], ["e2", "2026-10-01T17:00"],
        ] as const) await Punches.addManual("c1", { userId, at, direction: null, note: "terminal down" }, "a1")
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const day = async (userId: string, date: string) => (await db.query(`SELECT * FROM "AttendanceDay" WHERE "userId" = $1 AND date = $2`, [userId, date])).rows[0]
    const refused = (q: Promise<unknown>, constraint: string) => expect(q).rejects.toMatchObject({ constraint })

    it("holds each mission, refusing one by hours without its part of the day or across two dates, and dates the wrong way round", async () => {
        await refused(mission("x1", "e1", "HOURS", "2026-10-12", "2026-10-12", null, "PENDING"), "MissionRequest_kind_check")
        await refused(mission("x2", "e1", "HOURS", "2026-10-12", "2026-10-13", "TO_END", "PENDING"), "MissionRequest_kind_check")
        await refused(mission("x3", "e1", "DAYS", "2026-10-12", "2026-10-14", "TO_END", "PENDING"), "MissionRequest_kind_check")
        await refused(mission("x4", "e1", "DAYS", "2026-10-14", "2026-10-12", null, "PENDING"), "MissionRequest_dates_check")
        // Row Level Security is on, as for every table (DATABASE_SETUP.md).
        const { rows: [rls] } = await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'MissionRequest'`)
        expect(rls.relrowsecurity).toBe(true)
    })

    it("keeps a deleted task's title on the mission as text (decision 18)", async () => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "updatedAt") VALUES ('t1', 'Bank visit', 'd', 'IN_PROGRESS', now(), 'c1', now())`)
        await db.query(`INSERT INTO "MissionRequest"(id, "companyId", "userId", kind, "startDate", "endDate", "taskId", "taskTitle", reason)
            VALUES ('k1', 'c1', 'e1', 'DAYS', '2026-11-02', '2026-11-02', 't1', 'Bank visit', 'Deposit')`)
        await db.query(`DELETE FROM "Task" WHERE id = 't1'`)
        const { rows: [m] } = await db.query(`SELECT "taskId", "taskTitle", status FROM "MissionRequest" WHERE id = 'k1'`)
        expect(m).toEqual({ taskId: null, taskTitle: "Bank visit", status: "PENDING" })
        await db.query(`DELETE FROM "MissionRequest" WHERE id = 'k1'`)
    })

    it("makes each working day of a mission by days a Mission day, scans or not, charged nothing", async () => {
        expect(await day("e1", "2026-10-01")).toMatchObject({ status: "MISSION", punchCount: 2, workedMinutes: 0, overtimeMinutes: 0, deductionMinor: 0 })
        expect(await day("e1", "2026-10-04")).toMatchObject({ status: "MISSION", punchCount: 2, lateMinutes: 0, earlyLeaveMinutes: 0, deductionMinor: 0 })
        expect((await day("e1", "2026-10-04")).breakdown).toMatchObject({ mission: "DAYS", unpriced: null })
        // The same scans on a day without a mission wait as a departure to confirm.
        expect(await day("e1", "2026-10-05")).toMatchObject({ status: "TO_CONFIRM", lateMinutes: 90 })
    })

    it("leaves a rest day or holiday inside it as it is (decision 9)", async () => {
        expect(await day("e1", "2026-10-02")).toMatchObject({ status: "REST", overtimeMinutes: 0 })
        expect((await day("e1", "2026-10-02")).breakdown).toMatchObject({ mission: "DAYS" })
        expect(await day("e1", "2026-10-06")).toMatchObject({ status: "HOLIDAY", overtimeMinutes: 0, deductionMinor: 0 })
    })

    it("reads one scan as the departure from the start of the day, waiting past the threshold, and as the arrival until its end", async () => {
        expect(await day("e1", "2026-10-07")).toMatchObject({ status: "TO_CONFIRM", punchCount: 1, firstInAt: null, lateMinutes: 0, earlyLeaveMinutes: 300, deductionMinor: 0 })
        expect((await day("e1", "2026-10-07")).breakdown).toMatchObject({ mission: "FROM_START", unpriced: "TO_CONFIRM" })
        // Late, never incomplete: the month's first lateness, so free.
        expect(await day("e1", "2026-10-08")).toMatchObject({ status: "PRESENT", punchCount: 1, lastOutAt: null, lateMinutes: 40, earlyLeaveMinutes: 0 })
        expect((await day("e1", "2026-10-08")).breakdown).toMatchObject({ mission: "TO_END", lateness: { minutes: 40, note: "FREE_OCCURRENCE" } })
    })

    it("counts no mission that isn't approved", async () => {
        for (const date of ["2026-10-04", "2026-10-05", "2026-10-07", "2026-10-08"]) {
            expect(await day("e2", date)).toMatchObject({ status: "ABSENT" })
            expect((await day("e2", date)).breakdown.mission).toBeUndefined()
        }
    })

    it("lists a mission day by days on none of the Exceptions screen's tabs, and a day by hours as its kind charges", async () => {
        const out = await Exceptions.list("c1", { from: "2026-10-01", to: "2026-10-09" }, ALL, NONE)
        const of = (rows: { userId: string; date: string }[]) => rows.filter(r => r.userId === "e1").map(r => r.date).sort()
        expect(of(out.absent)).toEqual([])
        expect(of(out.incomplete)).toEqual([])
        expect(of(out.departure)).toEqual(["2026-10-05", "2026-10-07"])
        expect(of(out.late)).toEqual(["2026-10-08"])
        expect(of(out.early)).toEqual([])
    })

    it("tells nobody of a mission day: not absent, incomplete, nor a departure to confirm (decision 17, §13.4)", async () => {
        // The 10th: the 7th on is recent. Ehab's 7th waits and 8th was absent until its scan, both on missions;
        // Eman's 7th and 8th are absent, their missions withdrawn or cancelled.
        const told = async (userId: string) => (await db.query(`SELECT "messageKey", "messageParams"->'date'->>'date' AS d FROM "Notification"
            WHERE "userId" = $1 AND type = 'ATTENDANCE_DAY' AND "messageParams"->'date'->>'date' >= '2026-10-07' ORDER BY 2`, [userId])).rows
        expect(await told("e1")).toEqual([])
        expect(await told("e2")).toEqual([
            { messageKey: "notice_att_day_absent", d: "2026-10-07T00:00:00.000Z" },
            { messageKey: "notice_att_day_absent", d: "2026-10-08T00:00:00.000Z" },
        ])
    })

    it("skips the no-check-in reminder on a mission by days or from the start of the day, approved or waiting", async () => {
        const pairs = [
            { userId: "e1", date: "2026-10-04" }, { userId: "e1", date: "2026-10-07" }, { userId: "e1", date: "2026-10-08" },
            { userId: "e2", date: "2026-10-04" }, { userId: "e2", date: "2026-10-05" }, { userId: "e2", date: "2026-10-07" },
        ]
        expect([...await CheckIn.latenessWaivedFor("c1", pairs)].sort()).toEqual(["e1|2026-10-04", "e1|2026-10-07", "e2|2026-10-04"])
        // Calling a check-in late takes only an approved one, as for permission hours.
        expect([...await CheckIn.latenessWaivedFor("c1", pairs, { permissions: false })].sort()).toEqual(["e1|2026-10-04", "e1|2026-10-07"])
    })

    it("counts a mission approved after the day was worked out, and stops counting one no longer approved", async () => {
        const { AttendanceEngineService } = await import("@/lib/services/attendance-engine.service")
        await db.query(`UPDATE "MissionRequest" SET status = 'APPROVED' WHERE id = 'n1'`)
        await AttendanceEngineService.recomputeMonth("c1", "2026-10", ["e2"])
        expect(await day("e2", "2026-10-04")).toMatchObject({ status: "MISSION", deductionMinor: 0 })
        await db.query(`UPDATE "MissionRequest" SET status = 'CANCELLED' WHERE id = 'n1'`)
        await AttendanceEngineService.recomputeMonth("c1", "2026-10", ["e2"])
        expect(await day("e2", "2026-10-04")).toMatchObject({ status: "ABSENT", deductionMinor: 30000 })
    })
})
