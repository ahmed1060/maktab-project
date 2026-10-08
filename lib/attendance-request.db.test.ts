import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceRequestService as Requests } from "@/lib/services/attendance-request.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * Requests against a real Postgres built from the migrations (P0.6): permission
 * hours within the policy's allowance, decisions on overtime, reports of a
 * missing punch — and what each does to the days the engine derives.
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
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`

const NOW = new Date("2026-10-20T06:00:00Z")
const refusal = (code: string) => expect.objectContaining({ message: code })

describe.skipIf(!ADMIN_URL)("attendance requests, in Postgres", () => {
    const dbName = `request_test_${Date.now()}`
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
        // Ehab's punches, added by Amal: a full day on the 1st (the company's
        // first punch), then the days the requests are about.
        for (const [at, direction] of [
            ["2026-10-01T09:00", "IN"], ["2026-10-01T17:00", "OUT"],
            ["2026-10-15T09:00", "IN"],                              // forgot to punch out
            ["2026-10-18T09:00", "IN"], ["2026-10-18T18:30", "OUT"], // 90 minutes' overtime
            ["2026-10-19T09:00", "IN"], ["2026-10-19T16:00", "OUT"], // left an hour early
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

    const day = async (userId: string, date: string) =>
        (await db.query(`SELECT * FROM "AttendanceDay" WHERE "userId" = $1 AND date = $2`, [userId, date])).rows[0]

    describe("permission hours", () => {
        it("excuse the early leave they cover, once approved, and the day is priced again", async () => {
            expect(await day("e1", "2026-10-19")).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 60, excusedMinutes: 0 })
            // Asked the morning after: within the policy's 24 hours.
            const asked = await Requests.requestPermission("c1", "e1", { date: "2026-10-19", type: "EARLY_LEAVE", start: "16:00", end: "17:00", reason: "Doctor" })
            expect(asked).toMatchObject({ status: "PENDING", minutes: 60, start: "16:00", end: "17:00" })
            expect(await day("e1", "2026-10-19")).toMatchObject({ earlyLeaveMinutes: 60 })

            await expect(Requests.decidePermission(asked.id, { approve: true }, "e1")).rejects.toEqual(refusal("CANNOT_DECIDE_OWN"))
            await Requests.decidePermission(asked.id, { approve: true }, "a1")
            expect(await day("e1", "2026-10-19")).toMatchObject({ earlyLeaveMinutes: 0, excusedMinutes: 60, deductionMinor: 0 })
            // Ehab hears it (§13.4), in the bell's own words.
            const { rows: told } = await db.query(`SELECT "messageKey", "messageParams" FROM "Notification" WHERE "userId" = 'e1' AND type = 'ATTENDANCE_REQUEST'`)
            expect(told).toEqual([{ messageKey: "notice_att_permission_approved", messageParams: { date: { date: "2026-10-19T00:00:00.000Z" }, start: "16:00", end: "17:00", reason: "" } }])
            await expect(Requests.decidePermission(asked.id, { approve: false }, "a1")).rejects.toEqual(refusal("REQUEST_ALREADY_DECIDED"))
            // An approved permission that has begun stays.
            await expect(Requests.cancelPermission(asked.id, "e1")).rejects.toEqual(refusal("REQUEST_ALREADY_STARTED"))
        })

        it("excuse the morning end of a night shift, asked for under the night's date (review on #14)", async () => {
            // Nabil works nights, 22:00-06:00, and left at 05:00 on the 20th: the night of the 19th.
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'n1', 'n1@x', 'p', 'Nabil', 'Night', 'EMPLOYEE', 2026, 'n1', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            const night = await Calendar.createSchedule("c1", { name: "Night", version: { effectiveFrom: "2026-10-01", startMinutes: 1320, endMinutes: 1800, breakMinutes: 0 } }, "a1")
            await Calendar.assign("c1", { userIds: ["n1"], scheduleId: night.id, effectiveFrom: "2026-10-01" }, "a1")
            await Punches.addManual("c1", { userId: "n1", at: "2026-10-19T22:00", direction: "IN", note: "terminal down" }, "a1")
            await Punches.addManual("c1", { userId: "n1", at: "2026-10-20T05:00", direction: "OUT", note: "terminal down" }, "a1")
            expect(await day("n1", "2026-10-19")).toMatchObject({ earlyLeaveMinutes: 60, excusedMinutes: 0 })
            // Asked the same morning, within the policy's hours after.
            const asked = await Requests.requestPermission("c1", "n1", { date: "2026-10-19", type: "EARLY_LEAVE", start: "05:00", end: "06:00", reason: "Ill" })
            expect(asked).toMatchObject({ minutes: 60, start: "05:00", end: "06:00", startMinutes: 1740, endMinutes: 1800 })
            await Requests.decidePermission(asked.id, { approve: true }, "a1")
            expect(await day("n1", "2026-10-19")).toMatchObject({ earlyLeaveMinutes: 0, excusedMinutes: 60 })
        })

        it("are asked for in advance, or within the policy's hours after", async () => {
            await expect(Requests.requestPermission("c1", "e1", { date: "2026-10-18", type: "EARLY_LEAVE", start: "16:00", end: "17:00", reason: "x" }))
                .rejects.toEqual(refusal("PERMISSION_TOO_LATE"))
        })

        it("stay within the policy: its length, its allowance, its count, and no overlaps", async () => {
            const ask = (date: string, start: string, end: string) => Requests.requestPermission("c1", "e1", { date, type: "MIDDAY", start, end, reason: "Errand" })
            await expect(ask("2026-10-21", "12:00", "12:15")).rejects.toEqual(refusal("PERMISSION_TOO_SHORT"))
            await expect(ask("2026-10-21", "10:00", "13:00")).rejects.toEqual(refusal("PERMISSION_TOO_LONG"))
            await ask("2026-10-21", "12:00", "14:00")
            await expect(ask("2026-10-21", "13:00", "13:30")).rejects.toEqual(refusal("PERMISSION_OVERLAPS"))
            // 60 approved and 120 waiting of 240: 60 left.
            expect(await Requests.permissionBalance("c1", "e1", "2026-10")).toMatchObject({ allowanceMinutes: 240, approvedMinutes: 60, pendingMinutes: 120, remainingMinutes: 60, requests: 2 })
            await expect(ask("2026-10-22", "12:00", "13:30")).rejects.toEqual(refusal("PERMISSION_OVER_ALLOWANCE"))
            await ask("2026-10-22", "12:00", "12:30")
            await ask("2026-10-25", "12:00", "12:30")
            // The fifth of four.
            await expect(ask("2026-10-26", "12:00", "12:30")).rejects.toEqual(refusal("PERMISSION_TOO_MANY_REQUESTS"))
        })

        it("cannot both spend the last of an allowance when asked for at once", async () => {
            const ask = (start: string, end: string) => Requests.requestPermission("c1", "e2", { date: "2026-11-02", type: "MIDDAY", start, end, reason: "x" })
            await ask("09:00", "10:00")
            await ask("10:00", "11:00")
            // 120 of 240 taken: two more hours asked for at the same moment, one fits.
            const results = await Promise.allSettled([ask("12:00", "14:00"), ask("14:00", "16:00")])
            expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
            expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: refusal("PERMISSION_OVER_ALLOWANCE") })
        })

        it("can be withdrawn while waiting, and then free their minutes", async () => {
            const asked = await Requests.requestPermission("c1", "e2", { date: "2026-12-02", type: "LATE_ARRIVAL", start: "09:00", end: "10:00", reason: "x" })
            await expect(Requests.cancelPermission(asked.id, "e1")).rejects.toEqual(refusal("REQUEST_NOT_FOUND"))
            await Requests.cancelPermission(asked.id, "e2")
            expect(await Requests.permissionBalance("c1", "e2", "2026-12")).toMatchObject({ pendingMinutes: 0, remainingMinutes: 240 })
        })

        it("are checked against the allowance again when approved", async () => {
            const first = await Requests.requestPermission("c1", "e2", { date: "2027-01-04", type: "MIDDAY", start: "09:00", end: "11:00", reason: "x" })
            // The policy halves the allowance before anybody decides.
            await Policy.saveVersion("c1", { effectiveFrom: "2027-01-01", body: { ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, monthlyAllowanceMinutes: 60, maxPerRequestMinutes: 60 } } }, "a1")
            await expect(Requests.decidePermission(first.id, { approve: true }, "a1")).rejects.toEqual(refusal("PERMISSION_OVER_ALLOWANCE"))
            await Requests.decidePermission(first.id, { approve: false, reason: "Over the new allowance" }, "a1")
            expect((await db.query(`SELECT status, "rejectionReason" FROM "PermissionRequest" WHERE id = $1`, [first.id])).rows[0]).toEqual({ status: "REJECTED", rejectionReason: "Over the new allowance" })
        })

        it("carry last month's unused allowance once, when the policy says so", async () => {
            await Policy.saveVersion("c1", { effectiveFrom: "2027-02-01", body: { ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, carryOver: "CARRY_ONCE" } } }, "a1")
            await Policy.saveVersion("c1", { effectiveFrom: "2027-03-01", body: { ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, carryOver: "CARRY_ONCE" } } }, "a1")
            const used = await Requests.requestPermission("c1", "e1", { date: "2027-02-01", type: "MIDDAY", start: "12:00", end: "13:30", reason: "x" })
            await Requests.decidePermission(used.id, { approve: true }, "a1")
            // February: 240 of its own, and January's allowance — 60, under
            // the policy in force then — which Ehab left unused.
            expect(await Requests.permissionBalance("c1", "e1", "2027-02")).toMatchObject({ allowanceMinutes: 240, carriedMinutes: 60, approvedMinutes: 90 })
            // March: 240 less February's 90, carried; February's own carry does not carry again.
            expect(await Requests.permissionBalance("c1", "e1", "2027-03")).toMatchObject({ allowanceMinutes: 240, carriedMinutes: 150, remainingMinutes: 390 })
        })

        it("carry only what was neither used nor waiting, and never spend the same minutes twice (review on #14)", async () => {
            const ask = (date: string, start = "09:00", end = "11:00") => Requests.requestPermission("c1", "e2", { date, type: "MIDDAY", start, end, reason: "x" })
            // June 2027: 120 waiting. July carries what June leaves: 240 less those 120.
            await ask("2027-06-01")
            expect(await Requests.permissionBalance("c1", "e2", "2027-07")).toMatchObject({ allowanceMinutes: 240, carriedMinutes: 120, remainingMinutes: 360 })
            for (const d of ["2027-07-01", "2027-07-04", "2027-07-05"]) await ask(d)
            // July has spent its carry; June can't give the same minutes again.
            await expect(ask("2027-06-02")).rejects.toEqual(refusal("PERMISSION_OVER_ALLOWANCE"))
            expect((await db.query(`SELECT count(*)::int AS n FROM "PermissionRequest" WHERE "userId" = 'e2' AND date = '2027-06-02'`)).rows[0].n).toBe(0)
        })

        it("are shown under the policy of the day asked about (review on #14)", async () => {
            // Permission hours off from 1 August 2027.
            await Policy.saveVersion("c1", { effectiveFrom: "2027-08-01", body: { ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, enabled: false } } }, "a1")
            await Policy.saveVersion("c1", { effectiveFrom: "2027-09-15", body: { ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, types: ["MIDDAY"] } } }, "a1")
            expect(await Requests.permissionBalance("c1", "e1", "2027-08", "2027-08-10")).toMatchObject({ enabled: false })
            expect(await Requests.permissionBalance("c1", "e1", "2027-09", "2027-09-01")).toMatchObject({ enabled: false })
            expect(await Requests.permissionBalance("c1", "e1", "2027-09", "2027-09-20")).toMatchObject({ enabled: true, types: ["MIDDAY"] })
        })

        it("are refused in a month whose payroll is approved", async () => {
            await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run4', 'c1', 4, 2027, 'APPROVED', 25, now())`)
            await expect(Requests.requestPermission("c1", "e1", { date: "2027-04-05", type: "MIDDAY", start: "12:00", end: "13:00", reason: "x" }))
                .rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
        })
    })

    describe("overtime", () => {
        it("waits for a decision, is paid as far as approved, nothing once rejected, and waits again when withdrawn", async () => {
            expect(await day("e1", "2026-10-18")).toMatchObject({ overtimeMinutes: 90, overtimeStatus: "PENDING", overtimeMinor: 0 })
            await expect(Requests.decideOvertime("c1", { userId: "e1", date: "2026-10-18", status: "APPROVED" }, "e1")).rejects.toEqual(refusal("CANNOT_DECIDE_OWN"))

            const approved = await Requests.decideOvertime("c1", { userId: "e1", date: "2026-10-18", status: "APPROVED", minutes: 60 }, "a1")
            // An hour of a 420-minute paid day at 300.00 a day, times 1.35.
            expect(await day("e1", "2026-10-18")).toMatchObject({ overtimeStatus: "APPROVED", overtimeMinor: Math.round(30000 * 60 / 420 * 1.35) })
            // Without minutes, all of it.
            await Requests.decideOvertime("c1", { userId: "e1", date: "2026-10-18", status: "APPROVED" }, "a1")
            expect(await day("e1", "2026-10-18")).toMatchObject({ overtimeMinor: Math.round(30000 * 90 / 420 * 1.35) })

            await Requests.decideOvertime("c1", { userId: "e1", date: "2026-10-18", status: "REJECTED", note: "Not asked for" }, "a1")
            expect(await day("e1", "2026-10-18")).toMatchObject({ overtimeStatus: "REJECTED", overtimeMinor: 0 })

            await Requests.withdrawOvertime(approved.id, "a1")
            expect(await day("e1", "2026-10-18")).toMatchObject({ overtimeStatus: "PENDING", overtimeMinor: 0 })
        })

        it("can be approved ahead, for a stated number of minutes", async () => {
            await expect(Requests.decideOvertime("c1", { userId: "e1", date: "2026-10-27", status: "APPROVED" }, "a1")).rejects.toEqual(refusal("OVERTIME_MINUTES_REQUIRED"))
            expect(await Requests.decideOvertime("c1", { userId: "e1", date: "2026-10-27", status: "APPROVED", minutes: 120 }, "a1")).toMatchObject({ status: "APPROVED", approvedMinutes: 120 })
            const { waiting, decisions } = await Requests.overtime("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "COMPANY" })
            expect(waiting.map(w => [w.userId, w.date, w.overtimeMinutes])).toEqual([["e1", "2026-10-18", 90]])
            expect(decisions.map(d => [d.date, d.approvedMinutes])).toEqual([["2026-10-27", 120]])
        })
    })

    describe("a missing punch", () => {
        it("is a real time (review on #14)", async () => {
            for (const at of ["2026-13-01T09:00", "2026-10-01T25:00", "2026-02-30T09:00"]) {
                await expect(Requests.reportMissingPunch("c1", "e1", { at, direction: "IN", reason: "x" })).rejects.toEqual(refusal("INVALID_DATE"))
            }
        })

        it("is a time that has passed, reported once", async () => {
            await expect(Requests.reportMissingPunch("c1", "e1", { at: "2026-10-20T17:00", direction: "OUT", reason: "x" })).rejects.toEqual(refusal("PUNCH_IN_FUTURE"))
            const r = await Requests.reportMissingPunch("c1", "e1", { at: "2026-10-14T17:00", direction: "OUT", reason: "x" })
            await expect(Requests.reportMissingPunch("c1", "e1", { at: "2026-10-14T17:00", direction: "OUT", reason: "again" })).rejects.toEqual(refusal("MISSING_PUNCH_ALREADY_REPORTED"))
            await Requests.cancelMissingPunch(r.id, "e1")
            await expect(Requests.cancelMissingPunch(r.id, "e1")).rejects.toEqual(refusal("REQUEST_ALREADY_DECIDED"))
        })

        it("once approved adds the punch in the approver's name, and the day is complete", async () => {
            expect(await day("e1", "2026-10-15")).toMatchObject({ status: "INCOMPLETE" })
            const r = await Requests.reportMissingPunch("c1", "e1", { at: "2026-10-15T17:00", direction: "OUT", reason: "Forgot on the way out" })
            await expect(Requests.decideMissingPunch(r.id, { approve: true }, "e1")).rejects.toEqual(refusal("CANNOT_DECIDE_OWN"))
            await Requests.decideMissingPunch(r.id, { approve: true }, "a1")
            const { rows: [stored] } = await db.query(`SELECT r.status, p.source, p."createdById", p.note, to_char(p."punchAtLocal", 'YYYY-MM-DD"T"HH24:MI') AS at
                FROM "MissingPunchRequest" r JOIN "AttendancePunch" p ON p.id = r."punchId" WHERE r.id = $1`, [r.id])
            expect(stored).toEqual({ status: "APPROVED", source: "MANUAL", createdById: "a1", note: "Forgot on the way out", at: "2026-10-15T17:00" })
            expect(await day("e1", "2026-10-15")).toMatchObject({ status: "PRESENT", punchCount: 2, workedMinutes: 480 })
        })

        it("is refused when it is a night's check-out in a month whose payroll is approved (review on #14)", async () => {
            // Eman's night of 30 September ends at 06:00 on 1 October; September is approved.
            await db.query(`INSERT INTO "AttendanceDay"(id, "companyId", "userId", date, status, "expectedStartMinutes", "expectedEndMinutes", breakdown, "inputsHash")
                VALUES ('night30', 'c1', 'e2', '2026-09-30', 'INCOMPLETE', 1320, 1800, '{}', 'x')`)
            const before = await Requests.reportMissingPunch("c1", "e2", { at: "2026-10-01T06:10", direction: "OUT", reason: "Forgot" })
            await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run9', 'c1', 9, 2026, 'APPROVED', 25, now())`)
            await expect(Requests.decideMissingPunch(before.id, { approve: true }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await expect(Requests.reportMissingPunch("c1", "e2", { at: "2026-10-01T06:20", direction: "OUT", reason: "Forgot" })).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            // Past the night's late margin, it is October's.
            await Requests.reportMissingPunch("c1", "e2", { at: "2026-10-01T13:00", direction: "IN", reason: "Forgot" })
        })

        it("once rejected adds nothing", async () => {
            const r = await Requests.reportMissingPunch("c1", "e2", { at: "2026-10-13T09:00", direction: "IN", reason: "x" })
            await Requests.decideMissingPunch(r.id, { approve: false, reason: "You were on leave" }, "a1")
            const { rows: [told] } = await db.query(`SELECT "messageKey", message FROM "Notification" WHERE "userId" = 'e2' AND "relatedId" = $1`, [r.id])
            expect(told).toEqual({ messageKey: "notice_att_missing_rejected", message: expect.stringContaining("Reason: You were on leave") })
            expect((await db.query(`SELECT status, "punchId" FROM "MissingPunchRequest" WHERE id = $1`, [r.id])).rows[0]).toEqual({ status: "REJECTED", punchId: null })
        })
    })
})
