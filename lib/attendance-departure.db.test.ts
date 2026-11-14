import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceExceptionService as Exceptions } from "@/lib/services/attendance-exception.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * A departure to confirm against a real Postgres built from the migrations
 * (ATTENDANCE_PLAN.md §6.9, round 10, decisions 13, 23 and 26, PR 274): a
 * day whose early leave, after approved permission hours, is more than the
 * policy's threshold waits instead of being charged, on a tab of its own,
 * until its early leave is accepted or excused, or its departure scan added.
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
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`

const NOW = new Date("2026-10-10T06:00:00Z")
const refusal = (code: string) => expect.objectContaining({ message: code })
const ALL = { kind: "COMPANY" } as const
const NONE = { permissions: null, missing: null, unmatched: false }

describe.skipIf(!ADMIN_URL)("a departure to confirm, in Postgres", () => {
    const dbName = `departure_test_${Date.now()}`
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
        // Three hours approved to leave early on the 7th, from 14:00.
        await db.query(`INSERT INTO "PermissionRequest"(id, "companyId", "userId", date, type, "startMinutes", "endMinutes", minutes, reason, status)
            VALUES ('pr1', 'c1', 'e1', '2026-10-07', 'EARLY_LEAVE', 840, 1020, 180, 'Doctor', 'APPROVED')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-10-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-10-01", body: STANDARD_OFFICE }, "a1")
        for (const [at, direction] of [
            ["2026-10-01T09:00", "IN"], ["2026-10-01T17:00", "OUT"],
            ["2026-10-04T09:00", "IN"], ["2026-10-04T12:00", "OUT"], ["2026-10-04T12:40", "IN"], // forgot the last scan
            ["2026-10-05T09:00", "IN"], ["2026-10-05T15:30", "OUT"], // an hour and a half early: charged
            ["2026-10-07T09:00", "IN"], ["2026-10-07T14:00", "OUT"], // three hours early, on three approved
            ["2026-10-08T09:30", "IN"], ["2026-10-08T13:00", "OUT"], // late, then four hours early
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

    it("waits instead of charging early leave of more than two hours, the day's lateness included", async () => {
        expect(await day("2026-10-04")).toMatchObject({ status: "TO_CONFIRM", earlyLeaveMinutes: 260, deductionMinor: 0 })
        expect((await day("2026-10-04")).breakdown).toMatchObject({ unpriced: "TO_CONFIRM" })
        expect(await day("2026-10-08")).toMatchObject({ status: "TO_CONFIRM", lateMinutes: 30, earlyLeaveMinutes: 240, deductionMinor: 0 })
        // Two hours or less is charged as always: a whole day for more than an hour.
        expect(await day("2026-10-05")).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 90, deductionMinor: 30000 })
        // Approved permission hours count first: three hours early on three approved never waits (decision 23).
        expect(await day("2026-10-07")).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0, excusedMinutes: 180, deductionMinor: 0 })
    })

    it("lists the waiting days on a tab of their own, and not with the early leave that counts (decision 26)", async () => {
        const out = await list()
        expect(dates(out.departure)).toEqual(["2026-10-04", "2026-10-08"])
        expect(dates(out.early)).toEqual(["2026-10-05"])
        expect(out.counts).toMatchObject({ departure: 2, early: 1, incomplete: 0 })
        expect(out.capped).toMatchObject({ departure: false })
    })

    it("tells the person of a recent day that waits, once (§13.4)", async () => {
        // The 10th: the 7th on is recent, so the 8th is told and the 4th isn't. (The 7th and 8th were
        // also told absent, then incomplete, as their punches were added one by one.)
        const told = async () => (await db.query(`SELECT "messageKey", "messageParams"->'date'->>'date' AS d FROM "Notification" WHERE "userId" = 'e1' AND type = 'ATTENDANCE_DAY' AND "messageKey" = 'notice_att_day_to_confirm' ORDER BY 2`)).rows
        expect(await told()).toEqual([{ messageKey: "notice_att_day_to_confirm", d: "2026-10-08T00:00:00.000Z" }])
        const { AttendanceEngineService } = await import("@/lib/services/attendance-engine.service")
        await db.query(`UPDATE "AttendanceDay" SET "inputsHash" = 'stale' WHERE "userId" = 'e1'`)
        await AttendanceEngineService.recomputeMonth("c1", "2026-10")
        expect(await told()).toHaveLength(1)
    })

    it("is settled by accepting the early leave, which the policy then charges, and leaves the tab", async () => {
        await expect(Exceptions.decide("c1", { userId: "e1", date: "2026-10-04", subject: "EARLY_LEAVE", outcome: "ACCEPTED" }, "e1")).rejects.toEqual(refusal("CANNOT_CORRECT_OWN"))
        await Exceptions.decide("c1", { userId: "e1", date: "2026-10-04", subject: "EARLY_LEAVE", outcome: "ACCEPTED" }, "a1")
        expect(await day("2026-10-04")).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 260, deductionMinor: 30000 })
        const out = await list()
        expect(dates(out.departure)).toEqual(["2026-10-08"])
        expect(out.decided.map(d => [d.date, d.subject, d.outcome])).toEqual([["2026-10-04", "EARLY_LEAVE", "ACCEPTED"]])
        const { rows: [audit] } = await db.query(`SELECT action, details FROM "AuditLog" WHERE action = 'DECIDE_ATTENDANCE_DAY' ORDER BY "createdAt" DESC LIMIT 1`)
        expect(audit.details).toMatchObject({ date: "2026-10-04", subject: "EARLY_LEAVE", outcome: "ACCEPTED" })
    })

    it("or by excusing it, with a reason, which isn't charged", async () => {
        await expect(Exceptions.decide("c1", { userId: "e1", date: "2026-10-08", subject: "EARLY_LEAVE", outcome: "EXCUSED" }, "a1")).rejects.toEqual(refusal("REASON_REQUIRED"))
        await Exceptions.decide("c1", { userId: "e1", date: "2026-10-08", subject: "EARLY_LEAVE", outcome: "EXCUSED", reason: "Sent home ill" }, "a1")
        // The lateness is charged as any day's would be: the month's first, free.
        expect(await day("2026-10-08")).toMatchObject({ status: "PRESENT", lateMinutes: 30, earlyLeaveMinutes: 0, excusedMinutes: 240, deductionMinor: 0 })
        expect((await day("2026-10-08")).breakdown).toMatchObject({ lateness: { note: "FREE_OCCURRENCE" } })
        expect((await list()).departure).toEqual([])
    })

    it("waits again when its decision is undone", async () => {
        const { rows: [d] } = await db.query(`SELECT id FROM "AttendanceDayDecision" WHERE date = '2026-10-04'`)
        await Exceptions.withdraw(d.id, "a1")
        expect(await day("2026-10-04")).toMatchObject({ status: "TO_CONFIRM", deductionMinor: 0 })
        expect(dates((await list()).departure)).toEqual(["2026-10-04"])
    })

    it("is measured again once its departure scan is added", async () => {
        await Punches.addManual("c1", { userId: "e1", at: "2026-10-04T17:00", direction: "OUT", note: "Forgot to scan out" }, "a1")
        expect(await day("2026-10-04")).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0, workedMinutes: 480, deductionMinor: 0 })
        expect((await list()).departure).toEqual([])
    })

    it("decides only early leave that is there: not a day on time (review on #15)", async () => {
        await expect(Exceptions.decide("c1", { userId: "e1", date: "2026-10-01", subject: "EARLY_LEAVE", outcome: "ACCEPTED" }, "a1")).rejects.toEqual(refusal("NOTHING_TO_DECIDE"))
    })
})
