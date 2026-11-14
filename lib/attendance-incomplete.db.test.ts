import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceExceptionService as Exceptions } from "@/lib/services/attendance-exception.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * Settling an incomplete day against a real Postgres built from the
 * migrations (ATTENDANCE_PLAN.md §6.9, round 10, decision 22, PR 275): a day
 * with one scan, the other missing, is marked absent, which the policy
 * charges as an absence, or accepted as it is, charged nothing, each with a
 * reason, as a decision on the day itself.
 *
 * The clock is held at 09:00 on Saturday 10 October 2026 in Cairo (+03:00),
 * so days are worked out up to the 9th. The office works Sunday to
 * Thursday, 09:00–17:00, with an hour's break; Saturday is a rest day.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`

const NOW = new Date("2026-10-10T06:00:00Z")
const refusal = (code: string) => expect.objectContaining({ message: code })
const ALL = { kind: "COMPANY" } as const
const NONE = { permissions: null, missing: null, unmatched: false }

describe.skipIf(!ADMIN_URL)("settling an incomplete day, in Postgres", () => {
    const dbName = `incomplete_test_${Date.now()}`
    let db: Client

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
        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s1', 'e1', 9300, '2026-01-01T00:00:00Z')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-10-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-10-01", body: STANDARD_OFFICE }, "a1")
        for (const [at, direction] of [
            ["2026-10-01T09:00", "IN"], ["2026-10-01T17:00", "OUT"],
            ["2026-10-03T10:00", "IN"], // a Saturday, one scan
            ["2026-10-04T09:40", "IN"], // forty minutes late, then nothing
            ["2026-10-05T09:30", "IN"], // half an hour late, then nothing
            ["2026-10-07T10:00", "IN"], // recent, then nothing
            // The 8th: no scan at all, an absence.
        ] as const) await Punches.addManual("c1", { userId: "e1", at, direction, note: "terminal down" }, "a1")
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

    const day = async (date: string) => (await db.query(`SELECT * FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = $1`, [date])).rows[0]
    const list = () => Exceptions.list("c1", { from: "2026-10-01", to: "2026-10-09" }, ALL, NONE)
    const dates = (rows: { date: string }[]) => rows.map(r => r.date).sort()
    const settle = (date: string, outcome: "ACCEPTED" | "EXCUSED", reason?: string, actor = "a1") =>
        Exceptions.decide("c1", { userId: "e1", date, subject: "INCOMPLETE", outcome, reason }, actor)

    it("lists a day with one scan under Punch missing, charged nothing, and an absence with none under Absent", async () => {
        const out = await list()
        expect(dates(out.incomplete)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-07"])
        expect(dates(out.absent)).toEqual(["2026-10-08"])
        expect(await day("2026-10-04")).toMatchObject({ status: "INCOMPLETE", punchCount: 1, deductionMinor: 0 })
        expect((await day("2026-10-04")).breakdown).toMatchObject({ unpriced: "INCOMPLETE" })
    })

    it("marks a day absent only with a reason, never one's own, and the policy charges it as an absence", async () => {
        await expect(settle("2026-10-04", "ACCEPTED", "Never came back", "e1")).rejects.toEqual(refusal("CANNOT_CORRECT_OWN"))
        await expect(settle("2026-10-04", "ACCEPTED")).rejects.toEqual(refusal("REASON_REQUIRED"))
        await expect(settle("2026-10-04", "ACCEPTED", "   ")).rejects.toEqual(refusal("REASON_REQUIRED"))
        await settle("2026-10-04", "ACCEPTED", "Scanned in, then went home ill")
        // Its one scan kept, its lateness not counted: a whole day, 300.00.
        expect(await day("2026-10-04")).toMatchObject({ status: "ABSENT", punchCount: 1, lateMinutes: 0, deductionMinor: 30000 })
        expect((await day("2026-10-04")).breakdown).toMatchObject({ absenceDays: 1, unpriced: null, settled: "ABSENT" })
        const out = await list()
        // Under Decided, and neither waiting on its scan nor listed as an absence to decide.
        expect(dates(out.incomplete)).toEqual(["2026-10-03", "2026-10-05", "2026-10-07"])
        expect(dates(out.absent)).toEqual(["2026-10-08"])
        expect(out.decided.map(d => [d.date, d.subject, d.outcome, d.reason])).toEqual([["2026-10-04", "INCOMPLETE", "ACCEPTED", "Scanned in, then went home ill"]])
        const { rows: [audit] } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'DECIDE_ATTENDANCE_DAY' ORDER BY "createdAt" DESC LIMIT 1`)
        expect(audit.details).toMatchObject({ date: "2026-10-04", subject: "INCOMPLETE", outcome: "ACCEPTED", reason: "Scanned in, then went home ill" })
    })

    it("accepts a day as it is only with a reason, and charges nothing of it, its lateness included", async () => {
        await expect(settle("2026-10-05", "EXCUSED")).rejects.toEqual(refusal("REASON_REQUIRED"))
        await settle("2026-10-05", "EXCUSED", "At a client all afternoon")
        expect(await day("2026-10-05")).toMatchObject({ status: "PRESENT", punchCount: 1, lateMinutes: 0, excusedMinutes: 30, deductionMinor: 0 })
        expect((await day("2026-10-05")).breakdown).toMatchObject({ unpriced: null, settled: "AS_IT_IS" })
        expect(dates((await list()).incomplete)).toEqual(["2026-10-03", "2026-10-07"])
    })

    it("accepts a rest day's one scan as worked, with no overtime, and can't mark it absent", async () => {
        await expect(settle("2026-10-03", "ACCEPTED", "Not expected in")).rejects.toEqual(refusal("NOTHING_TO_DECIDE"))
        await settle("2026-10-03", "EXCUSED", "Came in to collect a laptop")
        expect(await day("2026-10-03")).toMatchObject({ status: "WORKED_REST_DAY", workedMinutes: 0, overtimeMinutes: 0, deductionMinor: 0 })
    })

    it("tells the person of a recent day marked absent, as of any absence (§13.4)", async () => {
        const told = async (date: string) => Number((await db.query(`SELECT count(*) FROM "Notification" WHERE "userId" = 'e1' AND type = 'ATTENDANCE_DAY' AND "messageKey" = 'notice_att_day_absent' AND "messageParams"->'date'->>'date' = $1`, [`${date}T00:00:00.000Z`])).rows[0].count)
        // The 7th was told absent once already, before its scan was added; the 4th, not recent, never.
        expect(await told("2026-10-07")).toBe(1)
        expect(await told("2026-10-04")).toBe(0)
        await settle("2026-10-07", "ACCEPTED", "Left after the morning scan")
        expect(await told("2026-10-07")).toBe(2)
    })

    it("is incomplete again when its decision is undone", async () => {
        const { rows: [d] } = await db.query(`SELECT id FROM "AttendanceDayDecision" WHERE date = '2026-10-04'`)
        await Exceptions.withdraw(d.id, "a1")
        expect(await day("2026-10-04")).toMatchObject({ status: "INCOMPLETE", deductionMinor: 0 })
        expect(dates((await list()).incomplete)).toEqual(["2026-10-04"])
    })

    it("is measured from its scans once the missing one is added, the decision then counting for nothing", async () => {
        await Punches.addManual("c1", { userId: "e1", at: "2026-10-05T17:00", direction: "OUT", note: "Forgot to scan out" }, "a1")
        // Half an hour late, the month's first: free.
        expect(await day("2026-10-05")).toMatchObject({ status: "PRESENT", punchCount: 2, lateMinutes: 30, workedMinutes: 450, deductionMinor: 0 })
        expect((await day("2026-10-05")).breakdown).toMatchObject({ lateness: { note: "FREE_OCCURRENCE" } })
        expect((await day("2026-10-05")).breakdown.settled).toBeUndefined()
    })

    it("decides only a day with one scan: not an absence with none, nor a day present (review on #15)", async () => {
        await expect(settle("2026-10-08", "EXCUSED", "Ill")).rejects.toEqual(refusal("NOTHING_TO_DECIDE"))
        await expect(settle("2026-10-01", "ACCEPTED", "Wrong day")).rejects.toEqual(refusal("NOTHING_TO_DECIDE"))
    })
})
