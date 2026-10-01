import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceExceptionService as Exceptions } from "@/lib/services/attendance-exception.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * Daily exceptions against a real Postgres built from the migrations (§13.1):
 * what needs a decision, and what excusing or accepting it does to the day.
 *
 * The clock is held at 09:00 on Tuesday 20 October 2026 in Cairo (+03:00).
 * The office works Sunday to Thursday, 09:00–17:00, with an hour's break.
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

const NOW = new Date("2026-10-20T06:00:00Z")
const refusal = (code: string) => expect.objectContaining({ message: code })
const ALL = { kind: "COMPANY" } as const
const NONE = { permissions: null, missing: null, unmatched: false }

describe.skipIf(!ADMIN_URL)("daily exceptions, in Postgres", () => {
    const dbName = `exception_test_${Date.now()}`
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
            ["2026-10-04T09:40", "IN"], ["2026-10-04T17:00", "OUT"], // late 40: the first free one
            ["2026-10-05T09:05", "IN"], ["2026-10-05T17:00", "OUT"], // late 5: within grace
            // 6 October is Armed Forces Day, a public holiday.
            ["2026-10-07T09:45", "IN"], ["2026-10-07T17:00", "OUT"], // late 45: the second free one
            ["2026-10-08T10:00", "IN"], ["2026-10-08T17:00", "OUT"], // late 60: charged half a day
            ["2026-10-11T09:00", "IN"],                              // forgot to punch out
            ["2026-10-12T09:00", "IN"], ["2026-10-12T19:00", "OUT"], // two hours' overtime, waiting
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
    const list = () => Exceptions.list("c1", { from: "2026-10-01", to: "2026-10-19" }, ALL, NONE)
    const dates = (rows: { userId: string; date: string }[], userId = "e1") => rows.filter(r => r.userId === userId).map(r => r.date).sort()

    it("lists only what needs a decision: lateness that counts, absences, a missing punch, overtime waiting", async () => {
        const out = await list()
        // Lateness within grace is not an exception; the free ones are, since they count.
        expect(dates(out.late)).toEqual(["2026-10-04", "2026-10-07", "2026-10-08"])
        expect(dates(out.incomplete)).toEqual(["2026-10-11"])
        expect(dates(out.overtime)).toEqual(["2026-10-12"])
        expect(dates(out.absent)).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-18", "2026-10-19"])
        expect(out.counts).toMatchObject({ late: 3, early: 0, incomplete: 1, overtime: 1, permissions: null, missing: null, unmatched: null })
    })

    it("excuses lateness with a reason: not charged, recorded as excused, off the list", async () => {
        expect(await day("2026-10-08")).toMatchObject({ lateMinutes: 60, deductionMinor: 15000 })
        await expect(Exceptions.decide("c1", { userId: "e1", date: "2026-10-08", subject: "LATENESS", outcome: "EXCUSED" }, "a1")).rejects.toEqual(refusal("REASON_REQUIRED"))
        await expect(Exceptions.decide("c1", { userId: "e1", date: "2026-10-08", subject: "LATENESS", outcome: "EXCUSED", reason: "x" }, "e1")).rejects.toEqual(refusal("CANNOT_CORRECT_OWN"))
        await Exceptions.decide("c1", { userId: "e1", date: "2026-10-08", subject: "LATENESS", outcome: "EXCUSED", reason: "Metro strike" }, "a1")
        expect(await day("2026-10-08")).toMatchObject({ lateMinutes: 0, excusedMinutes: 60, deductionMinor: 0 })
        const out = await list()
        expect(dates(out.late)).toEqual(["2026-10-04", "2026-10-07"])
        expect(out.decided.map(d => [d.date, d.subject, d.outcome, d.reason])).toEqual([["2026-10-08", "LATENESS", "EXCUSED", "Metro strike"]])
    })

    it("excuses an absence — still an absence, charged nothing — or accepts one as charged", async () => {
        await Exceptions.decide("c1", { userId: "e1", date: "2026-10-13", subject: "ABSENCE", outcome: "EXCUSED", reason: "Hospital, note seen" }, "a1")
        expect(await day("2026-10-13")).toMatchObject({ status: "ABSENT", deductionMinor: 0 })
        await Exceptions.decide("c1", { userId: "e1", date: "2026-10-14", subject: "ABSENCE", outcome: "ACCEPTED" }, "a1")
        expect(await day("2026-10-14")).toMatchObject({ status: "ABSENT", deductionMinor: 30000 })
        expect(dates((await list()).absent)).toEqual(["2026-10-15", "2026-10-18", "2026-10-19"])
    })

    it("can be withdrawn: the day is charged as measured, and listed again", async () => {
        const { rows: [d] } = await db.query(`SELECT id FROM "AttendanceDayDecision" WHERE date = '2026-10-08'`)
        await expect(Exceptions.withdraw(d.id, "e1")).rejects.toEqual(refusal("CANNOT_CORRECT_OWN"))
        await Exceptions.withdraw(d.id, "a1")
        expect(await day("2026-10-08")).toMatchObject({ lateMinutes: 60, deductionMinor: 15000 })
        expect(dates((await list()).late)).toEqual(["2026-10-04", "2026-10-07", "2026-10-08"])
    })

    it("counts what waits on the other tabs, for whoever decides it", async () => {
        await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", source, "sourceKey", "hardwareUserId", "punchAtLocal", "punchAt", "resolvedWithTimeZone")
            VALUES ('u1', 'c1', 'IMPORT', 'u1', '77', '2026-10-05 09:00', '2026-10-05 06:00', 'Africa/Cairo')`)
        await db.query(`INSERT INTO "PermissionRequest"(id, "companyId", "userId", date, type, "startMinutes", "endMinutes", minutes, reason) VALUES ('pr1', 'c1', 'e1', '2026-10-22', 'MIDDAY', 720, 780, 60, 'x')`)
        const out = await Exceptions.list("c1", { from: "2026-10-01", to: "2026-10-19" }, ALL, { permissions: ALL, missing: ALL, unmatched: true })
        expect(out.counts).toMatchObject({ permissions: 1, missing: 0, unmatched: 1 })
    })

    it("tells the person when a recent day becomes absent or has a punch missing, once (§13.4)", async () => {
        // The 20th: the 17th on is recent. Ehab's 18th and 19th were absent;
        // the 11th's missing punch and the earlier absences are older.
        const told = async () => (await db.query(`SELECT "messageKey", "messageParams"->'date'->>'date' AS d FROM "Notification" WHERE "userId" = 'e1' AND type = 'ATTENDANCE_DAY' ORDER BY 2, "createdAt"`)).rows
        expect(await told()).toEqual([
            { messageKey: "notice_att_day_absent", d: "2026-10-18T00:00:00.000Z" },
            { messageKey: "notice_att_day_absent", d: "2026-10-19T00:00:00.000Z" },
        ])
        // Rebuilding the month finds them absent already, and says nothing more.
        const { AttendanceEngineService } = await import("@/lib/services/attendance-engine.service")
        await db.query(`UPDATE "AttendanceDay" SET "inputsHash" = 'stale' WHERE "userId" = 'e1'`)
        await AttendanceEngineService.recomputeMonth("c1", "2026-10")
        expect(await told()).toHaveLength(2)
        // A punch in on the 19th with none out: incomplete now, and told.
        await Punches.addManual("c1", { userId: "e1", at: "2026-10-19T09:00", direction: "IN", note: "terminal down" }, "a1")
        expect((await told()).map(x => x.messageKey)).toEqual(["notice_att_day_absent", "notice_att_day_absent", "notice_att_day_incomplete"])
    })

    it("is refused in a month whose payroll is approved", async () => {
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run10', 'c1', 10, 2026, 'APPROVED', 25, now())`)
        await expect(Exceptions.decide("c1", { userId: "e1", date: "2026-10-15", subject: "ABSENCE", outcome: "ACCEPTED" }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
    })
})
