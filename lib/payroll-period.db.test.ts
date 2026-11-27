import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { PayrollRunService as Payroll } from "@/lib/services/payroll-run.service"
import { PayrollPeriodService as Periods } from "@/lib/services/payroll-period.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { AttendanceExceptionService as Exceptions } from "@/lib/services/attendance-exception.service"
import { AttendanceEngineService as Engine } from "@/lib/services/attendance-engine.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"
import { addDays, weekdayOf } from "@/lib/attendance/calendar"

/**
 * Payday and the attendance period, against a real Postgres built from the
 * migrations (LATER_CHANGES_PLAN.md §7.10, PR 430).
 *
 * A made-up company paid on the 25th of its own month, with September
 * approved, before the migration: it's moved onto day 1 of the month
 * after, and September keeps the calendar month it was paid for. Then,
 * on 27 November (in Cairo): payroll closes on the 24th; Ehab works
 * 09:00 to 17:00 every working day but the 19th, absent in November's
 * period, and the 26th, absent after it, as Omar was.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Made Up', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`
// September, approved before the migration, paid on the 25th as the company was.
const SEPTEMBER = `INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('r9', 'c1', 9, 2026, 'APPROVED', 25, now())`

const NOW = new Date("2026-11-27T08:00:00Z")
const SESSION = { user: { id: "a1", role: "ADMIN" } }

describe.skipIf(!ADMIN_URL)("payday and the attendance period, in Postgres", () => {
    const dbName = `payroll_period_test_${Date.now()}`
    let db: Client
    const company = async () => (await db.query(`SELECT "payrollDay", "paydayLastDay", "paydayNextMonth", "paydayMove", "payrollCloseDay" FROM "Company" WHERE id = 'c1'`)).rows[0]
    const run = async (month: number) => (await db.query(`SELECT status, to_char("periodStart", 'YYYY-MM-DD') AS "from", to_char("periodEnd", 'YYYY-MM-DD') AS "to", to_char(payday, 'YYYY-MM-DD') AS payday, "paydayChanged" FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2026 AND month = $1`, [month])).rows[0]
    const frozen = async (date: string) => (await db.query(`SELECT "lockedByPayrollRunId" IS NOT NULL AS frozen FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = $1`, [date])).rows[0]?.frozen ?? null

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
            if (m === "20270124000000_payday_and_close") await db.query(SEPTEMBER)
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()

        await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
            ('s1', 'e1', 9300, '2026-01-01T00:00:00Z'), ('s2', 'a1', 15000, '2026-01-01T00:00:00Z')`)
        await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
            ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z'), ('h2', 'a1', 'HIRED', '2026-01-01T00:00:00Z')`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-10-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-10-01", body: STANDARD_OFFICE }, "a1")
        await db.query(`UPDATE "Company" SET "attendancePayrollFrom" = '2026-10-01' WHERE id = 'c1'`)

        const { rows: holidays } = await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM "PublicHoliday" WHERE date BETWEEN '2026-10-01' AND '2026-11-30'`)
        const off = new Set(holidays.map(h => h.d))
        const rows: string[][] = [["AC-No.", "Check Time"]]
        for (let d = "2026-10-01"; d <= "2026-11-26"; d = addDays(d, 1)) {
            if (![0, 1, 2, 3, 4].includes(weekdayOf(d)) || off.has(d)) continue
            const dmy = (t: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${t}`
            rows.push(["2", dmy("09:00")], ["2", dmy("17:00")])
            // Absent on the 19th, in November's period, and on the 26th, after November closes on the 24th.
            if (d !== "2026-11-19" && d !== "2026-11-26") rows.push(["1", dmy("09:00")], ["1", dmy("17:00")])
        }
        await Punches.mapCode("c1", { code: "1", userId: "e1" }, "a1")
        await Punches.mapCode("c1", { code: "2", userId: "a1" }, "e1")
        await Punches.importRows("c1", { name: "autumn.csv", hash: "autumn", rows }, { dateOrder: "DMY" }, "a1", true)
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

    it("moves the company onto day 1 of the month after, and keeps the month approved before as it was paid", async () => {
        expect(await company()).toEqual({ payrollDay: 1, paydayLastDay: false, paydayNextMonth: true, paydayMove: "BEFORE", payrollCloseDay: null })
        expect(await run(9)).toEqual({ status: "APPROVED", from: "2026-09-01", to: "2026-09-30", payday: "2026-09-25", paydayChanged: false })
    })

    it("works out each month's period from the month before's close, a changed close making one shorter, never a gap", async () => {
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        // September closed on its last day: October runs from the 1st to the 24th.
        expect(await Periods.periodOf((await import("@/lib/prisma")).prisma, "c1", 2026, 10)).toEqual({ from: "2026-10-01", to: "2026-10-24" })
        expect(await Periods.periodOf((await import("@/lib/prisma")).prisma, "c1", 2026, 11)).toEqual({ from: "2026-10-25", to: "2026-11-24" })
        const months = await Periods.payrollMonthsOf((await import("@/lib/prisma")).prisma, "c1", ["2026-11-24", "2026-11-25", "2026-11-26"])
        expect([...months.values()]).toEqual(["2026-11", "2026-12", "2026-12"])
    })

    it("moves payday off a day off, and never back into the period", async () => {
        const { prisma } = await import("@/lib/prisma")
        // November is paid on Tuesday 1 December, a working day.
        expect(await Periods.paydayOf(prisma, "c1", 2026, 11)).toEqual({ date: "2026-12-01", changed: false })
        // December on 1 January 2027, a Friday: the day before, the 31st, as payroll closes on the 24th.
        expect((await Periods.paydayOf(prisma, "c1", 2026, 12)).date).toBe("2026-12-31")
        // Closing on the month's last day, the 31st is in the period: Saturday is off too, so Sunday the 3rd.
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
        expect((await Periods.paydayOf(prisma, "c1", 2026, 12)).date).toBe("2027-01-03")
        // A holiday of its own on 1 December moves November's to the 2nd, the 30th being in the period.
        await db.query(`INSERT INTO "CompanyHoliday"(id, "companyId", date, name) VALUES ('ch1', 'c1', '2026-12-01', 'Made up')`)
        expect((await Periods.paydayOf(prisma, "c1", 2026, 11)).date).toBe("2026-12-02")
        await db.query(`DELETE FROM "CompanyHoliday" WHERE id = 'ch1'`)
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
    })

    it("keeps a month's close where the approved month after it begins, and its payday change can't move it (review on PR 430)", async () => {
        const { prisma } = await import("@/lib/prisma")
        // February 2027 approved from 20 January: January's attendance ends on the 19th, whatever the setting says.
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt", "periodStart", "periodEnd", payday) VALUES ('r27', 'c1', 2, 2027, 'APPROVED', 1, now(), '2027-01-20', '2027-02-24', '2027-03-01')`)
        expect(await Periods.periodOf(prisma, "c1", 2027, 1)).toEqual({ from: "2026-12-25", to: "2027-01-19" })
        expect([...(await Periods.payrollMonthsOf(prisma, "c1", ["2027-01-19", "2027-01-22"])).values()]).toEqual(["2027-01", "2027-02"])
        expect(await Payroll.changePayday("c1", 2027, 1, { payday: "2027-01-25", attendanceUntil: "2027-01-15" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "PERIOD_FROZEN", periodEnd: "2027-01-19" }) })
        expect(await Payroll.changePayday("c1", 2027, 1, { payday: "2027-01-25" }, SESSION)).toEqual({ payday: "2027-01-25", periodEnd: "2027-01-19" })
        await db.query(`DELETE FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2027`)
    })

    it("goes by the work week of the policy in force on payday, not Friday and Saturday whatever it says", async () => {
        const { prisma } = await import("@/lib/prisma")
        // From 2027, a policy working Monday to Friday: Friday 1 January is a working day, and payday.
        await Policy.saveVersion("c1", { effectiveFrom: "2027-01-01", body: { ...STANDARD_OFFICE, workWeek: [1, 2, 3, 4, 5] } }, "a1")
        expect((await Periods.paydayOf(prisma, "c1", 2026, 12)).date).toBe("2027-01-01")
        await db.query(`DELETE FROM "AttendancePolicy" WHERE "companyId" = 'c1' AND "effectiveFrom" = '2027-01-01'`)
        expect((await Periods.paydayOf(prisma, "c1", 2026, 12)).date).toBe("2026-12-31")
    })

    it("refuses to approve a month before its period ends, saying from when", async () => {
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
        // Said first, before a day still to settle: the 23rd, left incomplete.
        const was = (await db.query(`SELECT status FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-23'`)).rows[0].status
        await db.query(`UPDATE "AttendanceDay" SET status = 'INCOMPLETE' WHERE "userId" = 'e1' AND date = '2026-11-23'`)
        try {
            const out = await Payroll.approve("c1", 2026, 11, SESSION)
            expect(out).toEqual({ refusal: expect.objectContaining({ code: "PERIOD_NOT_OVER", from: "2026-12-01" }) })
        } finally {
            await db.query(`UPDATE "AttendanceDay" SET status = $1 WHERE "userId" = 'e1' AND date = '2026-11-23'`, [was])
        }
        expect(await run(11)).toBeUndefined()
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
    })

    it("refuses where payday doesn't come after the close, as a net under the settings' own refusal", async () => {
        await db.query(`UPDATE "Company" SET "paydayNextMonth" = false, "payrollDay" = 20 WHERE id = 'c1'`)
        const out = await Payroll.approve("c1", 2026, 10, SESSION)
        expect(out).toEqual({ refusal: expect.objectContaining({ code: "PAYDAY_BEFORE_CLOSE" }) })
        await db.query(`UPDATE "Company" SET "paydayNextMonth" = true, "payrollDay" = 1 WHERE id = 'c1'`)
    })

    it("approves once the period's over, freezing the period's days and keeping its dates and payday", async () => {
        expect(await Payroll.approve("c1", 2026, 10, SESSION)).toHaveProperty("runId")
        // A settlement due on November's payday, 1 December in Cairo: November's to carry (review on PR 430).
        await db.query(`INSERT INTO "FinalSettlement"(id, "userId", "companyId", "lastWorkingDay", "earnedAmount", "paidAmount", "netAmount", "dueDate", "updatedAt") VALUES ('fs1', 'a1', 'c1', '2026-11-20T21:59:59Z', 100, 0, 100, '2026-11-30T22:00:00Z', now())`)
        // A day of November's in October, its row gone since: approving rebuilds it, then freezes it.
        await db.query(`DELETE FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-10-27'`)
        expect(await Payroll.approve("c1", 2026, 11, SESSION)).toHaveProperty("runId")
        expect(await run(11)).toEqual({ status: "APPROVED", from: "2026-10-25", to: "2026-11-24", payday: "2026-12-01", paydayChanged: false })
        expect(await frozen("2026-10-27")).toBe(true)
        expect(await frozen("2026-11-24")).toBe(true)
        const carried = (await db.query(`SELECT s.status, r.month FROM "FinalSettlement" s JOIN "PayrollRun" r ON r.id = s."payrollRunId" WHERE s.id = 'fs1'`)).rows[0]
        expect(carried).toEqual({ status: "APPROVED", month: 11 })
        await db.query(`DELETE FROM "FinalSettlement" WHERE id = 'fs1'`)
        expect(await frozen("2026-11-25")).toBe(false)
        // Approved, its payday stays as it was, whatever the setting says after.
        const { prisma } = await import("@/lib/prisma")
        await db.query(`UPDATE "Company" SET "payrollDay" = 5 WHERE id = 'c1'`)
        expect(await Periods.paydayOf(prisma, "c1", 2026, 11)).toEqual({ date: "2026-12-01", changed: false })
        await db.query(`UPDATE "Company" SET "payrollDay" = 1 WHERE id = 'c1'`)
    })

    it("finds the first payday on or after a date: a debt's due date, and when a settlement is paid", async () => {
        const { prisma } = await import("@/lib/prisma")
        // Paid in the month after, November's payday is in December, payday itself included.
        expect(await Periods.nextPaydayOnOrAfter(prisma, "c1", "2026-11-26")).toBe("2026-12-01")
        expect(await Periods.nextPaydayOnOrAfter(prisma, "c1", "2026-12-01")).toBe("2026-12-01")
        expect(await Periods.nextPaydayOnOrAfter(prisma, "c1", "2026-12-02")).toBe("2026-12-31")
        // October paid late, on 31 December: November's, on the 1st, is still the first (review on PR 430).
        await Payroll.changePayday("c1", 2026, 10, { payday: "2026-12-31" }, SESSION)
        expect(await Periods.nextPaydayOnOrAfter(prisma, "c1", "2026-11-26")).toBe("2026-12-01")
        await Payroll.changePayday("c1", 2026, 10, { payday: "2026-11-01" }, SESSION)
    })

    it("refuses a decision on a frozen day, and takes one on a day after the close, the next month's", async () => {
        await expect(Exceptions.decide("c1", { userId: "e1", date: "2026-11-23", subject: "LATENESS", outcome: "EXCUSED", reason: "Bus" }, "a1")).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        // Omar's day: absent on the 26th, after November closed, counted in December.
        const absent = (await db.query(`SELECT status FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-26'`)).rows[0]?.status
        expect(absent).toBe("ABSENT")
        await Exceptions.decide("c1", { userId: "e1", date: "2026-11-26", subject: "ABSENCE", outcome: "ACCEPTED" }, "a1")
    })

    it("still rebuilds the calendar month's days after the close, never a frozen one", async () => {
        const out = await Engine.recomputeMonth("c1", "2026-11")
        expect(out.locked).toBe(false)
        expect(await frozen("2026-11-20")).toBe(true)
        // October's days are October's and November's, both approved: nothing of it is rebuilt.
        expect((await Engine.recomputeMonth("c1", "2026-10")).locked).toBe(true)
    })

    it("counts in a leaver's settlement their attendance after the leaving month's payroll closed, and nothing before it", async () => {
        const { SettlementService } = await import("@/lib/services/settlement.service")
        // Leaving on the 24th, the close: November's payroll counts every day.
        expect(await SettlementService.attendanceAfterClose("c1", "e1", 2026, 11, "2026-11-24")).toBe(0)
        // No days at all, so ending it then keeps nothing of November's close and marks nothing (Codex review on PR 430).
        expect(await SettlementService.afterClose("c1", "e1", 2026, 11, "2026-11-24")).toBeNull()
        // Leaving on the 26th: the 25th worked, the 26th absent, which December's payroll won't pay them for.
        const after = await SettlementService.attendanceAfterClose("c1", "e1", 2026, 11, "2026-11-26")
        expect(after).toBeLessThan(0)
        const absent = (await db.query(`SELECT "deductionMinor" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-26'`)).rows[0].deductionMinor
        // Overtime on the 25th, after the close, waiting on a decision: it counts nothing until decided, and nothing
        // decides it once the settlement is made, so it isn't made before (review on PR 430). Before the close, it's
        // November's payroll's to wait on.
        const overtime = (await db.query(`SELECT "overtimeStatus" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-25'`)).rows[0].overtimeStatus
        await db.query(`UPDATE "AttendanceDay" SET "overtimeStatus" = 'PENDING' WHERE "userId" = 'e1' AND date = '2026-11-25'`)
        await expect(SettlementService.attendanceAfterClose("c1", "e1", 2026, 11, "2026-11-26")).rejects.toThrow("ATTENDANCE_PENDING")
        expect(await SettlementService.attendanceAfterClose("c1", "e1", 2026, 11, "2026-11-24")).toBe(0)
        await db.query(`UPDATE "AttendanceDay" SET "overtimeStatus" = $1 WHERE "userId" = 'e1' AND date = '2026-11-25'`, [overtime])
        // A mission on the 26th still to decide, the same.
        await db.query(`INSERT INTO "MissionRequest"(id, "companyId", "userId", kind, "startDate", "endDate", reason) VALUES ('m1', 'c1', 'e1', 'DAYS', '2026-11-26', '2026-11-26', 'A visit')`)
        await expect(SettlementService.attendanceAfterClose("c1", "e1", 2026, 11, "2026-11-26")).rejects.toThrow("ATTENDANCE_PENDING")
        await db.query(`DELETE FROM "MissionRequest" WHERE id = 'm1'`)
        // Their last working day not over yet, its attendance isn't known: not settled until it is (review on PR 430).
        await expect(SettlementService.preview("e1", "2026-11-27")).rejects.toThrow("ATTENDANCE_NOT_OVER")
        await expect(SettlementService.preview("e1", "2026-11-28")).rejects.toThrow("ATTENDANCE_NOT_OVER")
        // Only the 26th: the 19th's absence is November's payroll's, approved and paid there.
        const before = (await db.query(`SELECT "deductionMinor" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-19'`)).rows[0].deductionMinor
        expect(before).toBeGreaterThan(0)
        expect(after).toBe(-absent)
    })

    it("changes a draft month's payday, ending its attendance the day before, the days after going to the next month", async () => {
        // Never later than payroll closes, the 24th.
        expect(await Payroll.changePayday("c1", 2026, 12, { payday: "2026-12-30", attendanceUntil: "2026-12-26" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "ATTENDANCE_OUT_OF_RANGE", to: "2026-12-24" }) })
        // Nor before December's 1st, said or brought by the payday: the days after would be January's, two months
        // after their own, and a period would touch three calendar months (review on PR 430).
        expect(await Payroll.changePayday("c1", 2026, 12, { payday: "2026-12-01", attendanceUntil: "2026-11-28" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "ATTENDANCE_OUT_OF_RANGE", from: "2026-12-01" }) })
        expect(await Payroll.changePayday("c1", 2026, 12, { payday: "2026-11-30" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "ATTENDANCE_OUT_OF_RANGE", from: "2026-12-01" }) })
        expect(await run(12)).toBeUndefined()
        const out = await Payroll.changePayday("c1", 2026, 12, { payday: "2026-12-21" }, SESSION)
        expect(out).toEqual({ payday: "2026-12-21", periodEnd: "2026-12-20" })
        expect(await run(12)).toEqual(expect.objectContaining({ status: "DRAFT", to: "2026-12-20", payday: "2026-12-21", paydayChanged: true }))
        const { prisma } = await import("@/lib/prisma")
        expect(await Periods.periodOf(prisma, "c1", 2027, 1)).toEqual({ from: "2026-12-21", to: "2027-01-24" })
        // A payday kept where it's put, even on a day off: the 25th, a Friday.
        expect(await Payroll.changePayday("c1", 2026, 12, { payday: "2026-12-25", attendanceUntil: "2026-12-24" }, SESSION)).toEqual({ payday: "2026-12-25", periodEnd: "2026-12-24" })
        expect((await Periods.paydayOf(prisma, "c1", 2026, 12)).date).toBe("2026-12-25")
    })

    it("changes only payday once approved, still after the period, and refuses what isn't", async () => {
        expect(await Payroll.changePayday("c1", 2026, 11, { payday: "2026-11-30", attendanceUntil: "2026-11-20" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "PERIOD_FROZEN" }) })
        expect(await Payroll.changePayday("c1", 2026, 11, { payday: "2026-11-24" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "PAYDAY_NOT_AFTER_PERIOD" }) })
        // No later than the month after next: January, for November.
        expect(await Payroll.changePayday("c1", 2026, 11, { payday: "2027-02-01" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "PAYDAY_TOO_LATE" }) })
        // Closing on the 20th from now on, November's attendance still ends on the 24th, as approved: only payday changes (review on PR 430).
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = 20 WHERE id = 'c1'`)
        expect(await Payroll.changePayday("c1", 2026, 11, { payday: "2026-11-29" }, SESSION)).toEqual({ payday: "2026-11-29", periodEnd: "2026-11-24" })
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        expect(await Payroll.changePayday("c1", 2026, 11, { payday: "2026-11-30" }, SESSION)).toEqual({ payday: "2026-11-30", periodEnd: "2026-11-24" })
        expect(await run(11)).toEqual(expect.objectContaining({ status: "APPROVED", to: "2026-11-24", payday: "2026-11-30", paydayChanged: true }))
        await db.query(`UPDATE "PayrollRun" SET status = 'PAID' WHERE "companyId" = 'c1' AND year = 2026 AND month = 11`)
        expect(await Payroll.changePayday("c1", 2026, 11, { payday: "2026-12-01" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "RUN_PAID" }) })
    })

    it("keeps a leaver's attendance after the close on the settlement made, in what's owed too", async () => {
        const { SettlementService } = await import("@/lib/services/settlement.service")
        const after = await SettlementService.attendanceAfterClose("c1", "e1", 2026, 11, "2026-11-26")
        // Their last day not measured yet, as before the nightly job: settling measures it first.
        await db.query(`DELETE FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-26'`)
        await SettlementService.settleAndEnd({ userId: "e1", lastWorkingDay: "2026-11-26", createdById: "a1", actorRole: "ADMIN", actorName: "Amal One" })
        const kept = (await db.query(`SELECT "attendanceAmount"::float AS attendance, "earnedAmount"::float AS earned, "paidAmount"::float AS paid, "netAmount"::float AS net FROM "FinalSettlement" WHERE "userId" = 'e1'`)).rows[0]
        expect(kept.attendance).toBe(after / 100)
        expect(kept.net).toBeCloseTo(kept.earned - kept.paid + kept.attendance, 2)
        // What it counted is frozen with it (Codex review on PR 430): the 25th and 26th marked with it, never
        // rebuilt, and a change to them refused as one to a month already paid.
        const settlementId = (await db.query(`SELECT id FROM "FinalSettlement" WHERE "userId" = 'e1'`)).rows[0].id
        const marked = (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM "AttendanceDay" WHERE "userId" = 'e1' AND "lockedBySettlementId" = $1 ORDER BY date`, [settlementId])).rows.map(r => r.d)
        expect(marked).toEqual(["2026-11-25", "2026-11-26"])
        // Nor counted by a payroll, should he be taken back on: December's period never pays them again (Codex review on PR 430).
        const { attendanceMoney } = await import("@/lib/services/attendance-payroll")
        const { prisma } = await import("@/lib/prisma")
        expect((await attendanceMoney(prisma, "c1", { from: "2026-11-25", to: "2026-11-26" })).has("e1")).toBe(false)
        expect((await attendanceMoney(prisma, "c1", { from: "2026-11-25", to: "2026-11-26" })).has("a1")).toBe(true)
        await expect(Exceptions.decide("c1", { userId: "e1", date: "2026-11-26", subject: "ABSENCE", outcome: "EXCUSED", reason: "Ill" }, "a1")).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        await expect(Punches.addManual("c1", { userId: "e1", at: "2026-11-25T18:00", direction: "OUT", note: "Forgot" }, "a1")).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        const { AttendanceRequestService: Requests } = await import("@/lib/services/attendance-request.service")
        await expect(Requests.decideOvertime("c1", { userId: "e1", date: "2026-11-25", status: "APPROVED" }, "a1")).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        const day = (await db.query(`SELECT "deductionMinor", "inputsHash" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-26'`)).rows[0]
        await db.query(`UPDATE "AttendanceDay" SET "inputsHash" = 'stale', "deductionMinor" = 1 WHERE "userId" = 'e1' AND date = '2026-11-26'`)
        const ended = (await db.query(`SELECT id, "effectiveFrom" FROM "EmploymentEvent" WHERE "userId" = 'e1' AND type = 'CONTRACT_ENDED'`)).rows[0]
        try {
            await Engine.recomputeMonth("c1", "2026-11")
            expect((await db.query(`SELECT "deductionMinor" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-26'`)).rows[0]?.deductionMinor).toBe(1)
            // Nor dropped, should a rebuild no longer find it his: the contract's end moved to the 25th.
            await db.query(`UPDATE "EmploymentEvent" SET "effectiveFrom" = "effectiveFrom" - interval '1 day' WHERE id = $1`, [ended.id])
            await Engine.recomputeMonth("c1", "2026-11")
            expect((await db.query(`SELECT "deductionMinor" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-26'`)).rows[0]?.deductionMinor).toBe(1)
        } finally {
            await db.query(`UPDATE "EmploymentEvent" SET "effectiveFrom" = $1 WHERE id = $2`, [ended.effectiveFrom, ended.id])
            await db.query(`UPDATE "AttendanceDay" SET "inputsHash" = $1, "deductionMinor" = $2 WHERE "userId" = 'e1' AND date = '2026-11-26'`, [day.inputsHash, day.deductionMinor])
        }
    })

    it("refuses, once it holds the locks, a period that now ends later, not over yet (review on PR 430)", async () => {
        vi.setSystemTime(new Date("2026-12-28T08:00:00Z"))
        const real = Payroll.compute.bind(Payroll)
        let first = true
        // Payroll set to close on the 28th, today, between the first look and the locks.
        const spy = vi.spyOn(Payroll, "compute").mockImplementation(async (...args: Parameters<typeof Payroll.compute>) => {
            const out = await real(...args)
            if (first) {
                first = false
                await db.query(`UPDATE "Company" SET "payrollCloseDay" = 28 WHERE id = 'c1'`)
            }
            return out
        })
        try {
            expect(await Payroll.approve("c1", 2026, 12, SESSION)).toEqual({ refusal: expect.objectContaining({ code: "PERIOD_NOT_OVER", from: "2026-12-29" }) })
        } finally {
            spy.mockRestore()
            vi.setSystemTime(NOW)
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        }
        expect((await run(12)).status).toBe("DRAFT")
    })

    it("approves with the period as it is once it holds the locks, a payday changed meanwhile included (review on PR 430)", async () => {
        vi.setSystemTime(new Date("2026-12-28T08:00:00Z"))
        const real = Payroll.compute.bind(Payroll)
        let first = true
        // December's payday changed between the first look and the approval's locks.
        const spy = vi.spyOn(Payroll, "compute").mockImplementation(async (...args: Parameters<typeof Payroll.compute>) => {
            const out = await real(...args)
            if (first) {
                first = false
                await Payroll.changePayday("c1", 2026, 12, { payday: "2026-12-23", attendanceUntil: "2026-12-22" }, SESSION)
            }
            return out
        })
        try {
            expect(await Payroll.approve("c1", 2026, 12, SESSION)).toHaveProperty("runId")
        } finally {
            spy.mockRestore()
            vi.setSystemTime(NOW)
        }
        expect(await run(12)).toEqual(expect.objectContaining({ status: "APPROVED", from: "2026-11-25", to: "2026-12-22", payday: "2026-12-23" }))
        // Ehab's 26th, his settlement's, stays its: December's approval doesn't mark it as its own (Codex review on PR 430).
        expect((await db.query(`SELECT "lockedBySettlementId" IS NOT NULL AS settled, "lockedByPayrollRunId" IS NULL AS unpaid FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-26'`)).rows[0]).toEqual({ settled: true, unpaid: true })
    })

    it("decides a day after the close holding the locks of both months it can fall in, so approving can't freeze it in between (review on PR 430)", async () => {
        vi.setSystemTime(new Date("2027-02-02T08:00:00Z"))
        const real = Periods.monthsOfDates.bind(Periods)
        // Armed once the 26th is measured, for the decision's own read.
        let fired = true
        let approving: Promise<unknown> = Promise.resolve(null)
        // Between reading which payroll month the 26th falls in, February's with payroll closing on the 24th, and
        // writing to it: payroll set to close on the month's last day, making it January's, and January approved.
        const spy = vi.spyOn(Periods, "monthsOfDates").mockImplementation(async (...args: Parameters<typeof Periods.monthsOfDates>) => {
            const out = await real(...args)
            if (!fired) {
                fired = true
                await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
                let settled = false
                approving = Payroll.approve("c1", 2027, 1, SESSION).finally(() => { settled = true })
                // Until it's approved, or waits on a lock the decision holds.
                for (let i = 0; i < 600 && !settled; i++) {
                    const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'`)
                    if (rows[0].n > 0) break
                    await new Promise(r => setTimeout(r, 50))
                }
            }
            return out
        })
        try {
            // Ehab has left: Nour, who joined in December, missed the 26th.
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "roleId", "lastDayOffResetYear", username, "companyId")
                SELECT 'e2', 'e2@x', 'p', 'Nour', 'Two', role, "roleId", 2026, 'e2', 'c1' FROM "User" WHERE id = 'e1'`)
            await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s3', 'e2', 9300, '2026-12-01T00:00:00Z')`)
            await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES ('h3', 'e2', 'HIRED', '2026-12-01T00:00:00Z')`)
            await Engine.recomputeMonth("c1", "2027-01")
            expect((await db.query(`SELECT status FROM "AttendanceDay" WHERE "userId" = 'e2' AND date = '2027-01-26'`)).rows[0]?.status).toBe("ABSENT")
            fired = false
            const decided = await Exceptions.decide("c1", { userId: "e2", date: "2027-01-26", subject: "ABSENCE", outcome: "EXCUSED", reason: "Ill" }, "a1")
                .then(() => "DECIDED", (e: Error) => e.message)
            expect(await approving).toHaveProperty("runId")
            const day = (await db.query(`SELECT "deductionMinor", "lockedByPayrollRunId" IS NOT NULL AS frozen FROM "AttendanceDay" WHERE "userId" = 'e2' AND date = '2027-01-26'`)).rows[0]
            expect(day.frozen).toBe(true)
            // Refused, or decided before January was approved, which then counted it: never frozen without it.
            if (decided === "DECIDED") expect(day.deductionMinor).toBe(0)
            else expect(decided).toBe("PAYROLL_MONTH_LOCKED")
        } finally {
            spy.mockRestore()
            vi.setSystemTime(NOW)
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        }
    }, 120_000)

    it("refuses to approve a month whose payday, changed for it, its period has since moved past (review on PR 430)", async () => {
        vi.setSystemTime(new Date("2027-03-02T08:00:00Z"))
        const february = async () => (await db.query(`SELECT status FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2027 AND month = 2`)).rows[0]?.status
        const real = Payroll.compute.bind(Payroll)
        let first = true
        try {
            // Paid on the 25th, its attendance up to the 24th, the close: kept as the setting.
            expect(await Payroll.changePayday("c1", 2027, 2, { payday: "2027-02-25" }, SESSION)).toEqual({ payday: "2027-02-25", periodEnd: "2027-02-24" })
            // Payroll now closing on the month's last day, February's attendance runs to the 28th, past its payday.
            // Said first, before a day still to settle: Nour's 3rd, left incomplete.
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
            await Engine.recomputeMonth("c1", "2027-02")
            const was = (await db.query(`SELECT status FROM "AttendanceDay" WHERE "userId" = 'e2' AND date = '2027-02-03'`)).rows[0].status
            await db.query(`UPDATE "AttendanceDay" SET status = 'INCOMPLETE' WHERE "userId" = 'e2' AND date = '2027-02-03'`)
            expect(await Payroll.approve("c1", 2027, 2, SESSION)).toEqual({ refusal: expect.objectContaining({ code: "PAYDAY_BEFORE_CLOSE" }) })
            await db.query(`UPDATE "AttendanceDay" SET status = $1 WHERE "userId" = 'e2' AND date = '2027-02-03'`, [was])
            // And so once it holds the locks, the close moved between its first look and them.
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
            const spy = vi.spyOn(Payroll, "compute").mockImplementation(async (...args: Parameters<typeof Payroll.compute>) => {
                const out = await real(...args)
                if (first) {
                    first = false
                    await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
                }
                return out
            })
            try {
                expect(await Payroll.approve("c1", 2027, 2, SESSION)).toEqual({ refusal: expect.objectContaining({ code: "PAYDAY_BEFORE_CLOSE" }) })
            } finally {
                spy.mockRestore()
            }
            expect(await february()).toBe("DRAFT")
        } finally {
            vi.setSystemTime(NOW)
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        }
    })

    it("keeps the leaving month's close where a settlement counted from, while that month is a draft (Codex review on PR 430)", async () => {
        vi.setSystemTime(new Date("2027-03-02T08:00:00Z"))
        const { SettlementService } = await import("@/lib/services/settlement.service")
        const { prisma } = await import("@/lib/prisma")
        const leaving = { userId: "e2", lastWorkingDay: "2027-02-26", createdById: "a1", actorRole: "ADMIN", actorName: "Amal One" }
        const real = SettlementService.preview.bind(SettlementService)
        try {
            // Payroll set to close on the month's last day while the settlement was worked out: what it counted is
            // out of date, and nothing is written.
            const spy = vi.spyOn(SettlementService, "preview").mockImplementation(async (...args: Parameters<typeof SettlementService.preview>) => {
                const out = await real(...args)
                await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
                return out
            })
            try {
                await expect(SettlementService.settleAndEnd(leaving)).rejects.toThrow("PAYROLL_PERIOD_CHANGED")
            } finally {
                spy.mockRestore()
                await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "FinalSettlement" WHERE "userId" = 'e2'`)).rows[0].n).toBe(0)
            // Her absence on the 25th excused while it was worked out, its rebuild still to come: read again holding the
            // locks, and rebuilt, those days come to something else, and nothing is written (Codex review on PR 430).
            const excusing = vi.spyOn(SettlementService, "preview").mockImplementation(async (...args: Parameters<typeof SettlementService.preview>) => {
                const out = await real(...args)
                await db.query(`INSERT INTO "AttendanceDayDecision"(id, "companyId", "userId", date, subject, outcome, reason, "decidedById") VALUES ('x1', 'c1', 'e2', '2027-02-25', 'ABSENCE', 'EXCUSED', 'Ill', 'a1')`)
                return out
            })
            try {
                await expect(SettlementService.settleAndEnd(leaving)).rejects.toThrow("ATTENDANCE_CHANGED")
            } finally {
                excusing.mockRestore()
                await db.query(`DELETE FROM "AttendanceDayDecision" WHERE id = 'x1'`)
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "FinalSettlement" WHERE "userId" = 'e2'`)).rows[0].n).toBe(0)
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendanceDay" WHERE "userId" = 'e2' AND "lockedBySettlementId" IS NOT NULL`)).rows[0].n).toBe(0)
            // Or a mission on the 25th asked for meanwhile, still to decide: waited on, as at the preview.
            const asking = vi.spyOn(SettlementService, "preview").mockImplementation(async (...args: Parameters<typeof SettlementService.preview>) => {
                const out = await real(...args)
                await db.query(`INSERT INTO "MissionRequest"(id, "companyId", "userId", kind, "startDate", "endDate", reason) VALUES ('m2', 'c1', 'e2', 'DAYS', '2027-02-25', '2027-02-25', 'A visit')`)
                return out
            })
            try {
                await expect(SettlementService.settleAndEnd(leaving)).rejects.toThrow("ATTENDANCE_PENDING")
            } finally {
                asking.mockRestore()
                await db.query(`DELETE FROM "MissionRequest" WHERE id = 'm2'`)
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "FinalSettlement" WHERE "userId" = 'e2'`)).rows[0].n).toBe(0)
            // Nour leaves on 26 February, after it closes on the 24th: the 25th and 26th are settled.
            await SettlementService.settleAndEnd(leaving)
            const february = (await db.query(`SELECT status, to_char("periodEnd", 'YYYY-MM-DD') AS "to" FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2027 AND month = 2`)).rows[0]
            expect(february).toEqual({ status: "DRAFT", to: "2027-02-24" })
            const marked = (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM "AttendanceDay" WHERE "userId" = 'e2' AND "lockedBySettlementId" IS NOT NULL ORDER BY date`)).rows.map(r => r.d)
            expect(marked).toEqual(["2027-02-25", "2027-02-26"])
            // Payroll set to close on the month's last day since: February still ends on the 24th, so it never counts them too.
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
            expect(await Periods.periodOf(prisma, "c1", 2027, 2)).toEqual({ from: "2027-02-01", to: "2027-02-24" })
            // And Change payday changes only its payday.
            expect(await Payroll.changePayday("c1", 2027, 2, { payday: "2027-02-25", attendanceUntil: "2027-02-20" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "PERIOD_FROZEN", periodEnd: "2027-02-24" }) })
        } finally {
            vi.setSystemTime(NOW)
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        }
    })

    it("reads its period holding the company's settings, so they can't change in between (Codex review on PR 430)", async () => {
        vi.setSystemTime(new Date("2027-03-02T08:00:00Z"))
        const { prisma } = await import("@/lib/prisma")
        const real = Periods.periodOf.bind(Periods)
        let held: boolean | null = null
        const spy = vi.spyOn(Periods, "periodOf").mockImplementation(async (...args: Parameters<typeof Periods.periodOf>) => {
            // At the first read inside approval's transaction: could the Payroll settings be saved now?
            if (held === null && args[0] !== prisma) held = await db.query(`SELECT id FROM "Company" WHERE id = 'c1' FOR UPDATE NOWAIT`).then(() => false, () => true)
            return real(...args)
        })
        try {
            expect(await Payroll.approve("c1", 2027, 2, SESSION)).toHaveProperty("runId")
        } finally {
            spy.mockRestore()
            vi.setSystemTime(NOW)
        }
        expect(held).toBe(true)
    })

    it("keeps the leaving month's close with every settlement, and settles a month's last day's days after it (Codex review on PR 430)", async () => {
        vi.setSystemTime(new Date("2027-04-01T08:00:00Z"))
        const { SettlementService } = await import("@/lib/services/settlement.service")
        const { attendanceMoney } = await import("@/lib/services/attendance-payroll")
        const { prisma } = await import("@/lib/prisma")
        const march = async () => (await db.query(`SELECT status, to_char("periodEnd", 'YYYY-MM-DD') AS "to" FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2027 AND month = 3`)).rows[0]
        const marked = async (userId: string) => (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM "AttendanceDay" WHERE "userId" = $1 AND "lockedBySettlementId" IS NOT NULL ORDER BY date`, [userId])).rows.map(r => r.d)
        const leaving = (userId: string, lastWorkingDay: string) => ({ userId, lastWorkingDay, createdById: "a1", actorRole: "ADMIN", actorName: "Amal One" })
        try {
            // Two more who joined in December: Rami, leaving on 22 March, before it closes on the 24th, and Salma on
            // the 31st, the month's last day.
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "roleId", "lastDayOffResetYear", username, "companyId")
                SELECT 'e3', 'e3@x', 'p', 'Rami', 'Three', role, "roleId", 2026, 'e3', 'c1' FROM "User" WHERE id = 'e1'
                UNION ALL SELECT 'e4', 'e4@x', 'p', 'Salma', 'Four', role, "roleId", 2026, 'e4', 'c1' FROM "User" WHERE id = 'e1'`)
            await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s4', 'e3', 9300, '2026-12-01T00:00:00Z'), ('s5', 'e4', 9300, '2026-12-01T00:00:00Z')`)
            await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES ('h4', 'e3', 'HIRED', '2026-12-01T00:00:00Z'), ('h5', 'e4', 'HIRED', '2026-12-01T00:00:00Z')`)
            expect(await march()).toBeUndefined()
            await SettlementService.settleAndEnd(leaving("e3", "2027-03-22"))
            // No days after the close to settle, and the close kept all the same: moved sooner, the 23rd and 24th
            // would be April's period, which doesn't pay him, and in no settlement.
            expect(await marked("e3")).toEqual([])
            expect(await march()).toEqual({ status: "DRAFT", to: "2027-03-24" })
            // Change payday changes only its payday, and keeps its close where it's the setting's too.
            expect(await Payroll.changePayday("c1", 2027, 3, { payday: "2027-03-21", attendanceUntil: "2027-03-20" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "PERIOD_FROZEN", periodEnd: "2027-03-24" }) })
            expect(await Payroll.changePayday("c1", 2027, 3, { payday: "2027-03-28" }, SESSION)).toEqual({ payday: "2027-03-28", periodEnd: "2027-03-24" })
            expect(await march()).toEqual({ status: "DRAFT", to: "2027-03-24" })
            // Payroll set to close on the month's last day since: March still ends on the 24th.
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
            expect(await Periods.periodOf(prisma, "c1", 2027, 3)).toEqual({ from: "2027-02-25", to: "2027-03-24" })
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
            // Salma's 25th to 31st are after March closes, April's period, which doesn't pay her as she's left:
            // March's settlement does, as for a day before the month's last.
            await SettlementService.settleAndEnd(leaving("e4", "2027-03-31"))
            const days = (await marked("e4"))
            expect([days[0], days[days.length - 1]]).toEqual(["2027-03-25", "2027-03-31"])
            const owed = (await db.query(`SELECT sum("deductionMinor")::int AS d, count(*)::int AS n, count("lockedBySettlementId")::int AS kept FROM "AttendanceDay" WHERE "userId" = 'e4' AND date BETWEEN '2027-03-25' AND '2027-03-31'`)).rows[0]
            expect(owed.d).toBeGreaterThan(0)
            expect(owed.kept).toBe(owed.n)
            const kept = (await db.query(`SELECT "attendanceAmount"::float AS attendance FROM "FinalSettlement" WHERE "userId" = 'e4'`)).rows[0]
            expect(kept.attendance).toBeCloseTo(-owed.d / 100, 2)
            expect((await attendanceMoney(prisma, "c1", { from: "2027-03-25", to: "2027-03-31" })).has("e4")).toBe(false)
            // Her contract ends with March, in Cairo: April, with nobody settled in it, can still end sooner.
            expect(await Payroll.changePayday("c1", 2027, 4, { payday: "2027-04-21", attendanceUntil: "2027-04-20" }, SESSION)).toEqual({ payday: "2027-04-21", periodEnd: "2027-04-20" })
            await db.query(`DELETE FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2027 AND month = 4`)
        } finally {
            vi.setSystemTime(NOW)
            await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        }
    }, 120_000)

    it("lists the check-ins a decision would take, by the period, and never one a settlement or a payroll has paid (Codex review on PR 430)", async () => {
        vi.setSystemTime(new Date("2027-04-01T08:00:00Z"))
        const { AttendanceFlagService: Flags } = await import("@/lib/services/attendance-flag.service")
        const { SettlementService } = await import("@/lib/services/settlement.service")
        const { prisma } = await import("@/lib/prisma")
        const flagged = (id: string, userId: string, local: string, utc: string) => db.query(
            `INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status, "flagReasons")
             VALUES ($1, 'c1', $2, 'MOBILE', $1, $3, $4, 'Africa/Cairo', 'FLAGGED', '{OUTSIDE_AREA}')`, [id, userId, local, utc])
        try {
            // February is approved, closing on the 24th: the 25th is March's, still open. Amal's check-in then is
            // there to decide; Nour's isn't, a day her settlement counted.
            await flagged("f1", "a1", "2027-02-25T09:00:00", "2027-02-25T07:00:00Z")
            await flagged("f2", "e2", "2027-02-25T09:00:00", "2027-02-25T07:00:00Z")
            const listed = (await Flags.list("COMPANY", { companyId: "c1", visible: { kind: "COMPANY" } })).map(f => f.id)
            expect(listed).toContain("f1")
            expect(listed).not.toContain("f2")

            // Hani's 25th and 26th of March, after it closes, frozen by April's payroll, which paid him, before his
            // end on the 26th was recorded: that payroll's, not counted again by his settlement.
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "roleId", "lastDayOffResetYear", username, "companyId")
                SELECT 'e5', 'e5@x', 'p', 'Hani', 'Five', role, "roleId", 2026, 'e5', 'c1' FROM "User" WHERE id = 'e1'`)
            await db.query(`INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES ('s6', 'e5', 9300, '2026-12-01T00:00:00Z')`)
            await db.query(`INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES ('h6', 'e5', 'HIRED', '2026-12-01T00:00:00Z')`)
            await Engine.recomputeMonth("c1", "2027-03", ["e5"])
            const absent = (await db.query(`SELECT "deductionMinor" FROM "AttendanceDay" WHERE "userId" = 'e5' AND date = '2027-03-25'`)).rows[0].deductionMinor
            expect(absent).toBeGreaterThan(0)
            expect((await SettlementService.afterClose("c1", "e5", 2027, 3, "2027-03-26"))?.minor).toBe(-absent)
            await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "periodStart", "periodEnd", "updatedAt") VALUES ('r5', 'c1', 4, 2027, 'APPROVED', 1, '2027-03-25', '2027-04-24', now())`)
            await db.query(`INSERT INTO "Payslip"(id, "payrollRunId", "userId", "daysPaid", "updatedAt") VALUES ('p5', 'r5', 'e5', 30, now())`)
            await db.query(`UPDATE "AttendanceDay" SET "lockedByPayrollRunId" = 'r5' WHERE "userId" = 'e5' AND date BETWEEN '2027-03-25' AND '2027-03-31'`)
            expect((await SettlementService.afterClose("c1", "e5", 2027, 3, "2027-03-26"))?.minor).toBe(0)
            // Left out of that payroll, they were never paid: the settlement counts them.
            await db.query(`UPDATE "Payslip" SET excluded = true WHERE id = 'p5'`)
            expect((await SettlementService.afterClose("c1", "e5", 2027, 3, "2027-03-26"))?.minor).toBe(-absent)
            // His contract ended there: nothing counted again, and the days stay April's, not marked as settled.
            await db.query(`UPDATE "Payslip" SET excluded = false WHERE id = 'p5'`)
            await SettlementService.settleAndEnd({ userId: "e5", lastWorkingDay: "2027-03-26", createdById: "a1", actorRole: "ADMIN", actorName: "Amal One" })
            expect((await db.query(`SELECT "attendanceAmount"::float AS a FROM "FinalSettlement" WHERE "userId" = 'e5'`)).rows[0].a).toBe(0)
            expect((await db.query(`SELECT count(*)::int AS n FROM "AttendanceDay" WHERE "userId" = 'e5' AND "lockedBySettlementId" IS NOT NULL`)).rows[0].n).toBe(0)
            await db.query(`UPDATE "AttendanceDay" SET "lockedByPayrollRunId" = NULL WHERE "userId" = 'e5'`)
            await db.query(`DELETE FROM "PayrollRun" WHERE id = 'r5'`)

            // Change payday holds March's run from reading it to writing it: marking it paid meanwhile waits.
            const real = Periods.settings.bind(Periods)
            let held: boolean | null = null
            const spy = vi.spyOn(Periods, "settings").mockImplementation(async (...args: Parameters<typeof Periods.settings>) => {
                if (held === null && args[0] !== prisma) held = await db.query(`SELECT id FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2027 AND month = 3 FOR UPDATE NOWAIT`).then(() => false, () => true)
                return real(...args)
            })
            try {
                expect(await Payroll.changePayday("c1", 2027, 3, { payday: "2027-03-29" }, SESSION)).toEqual({ payday: "2027-03-29", periodEnd: "2027-03-24" })
            } finally {
                spy.mockRestore()
            }
            expect(held).toBe(true)
        } finally {
            vi.setSystemTime(NOW)
            await db.query(`DELETE FROM "AttendancePunch" WHERE id IN ('f1', 'f2')`)
            await db.query(`UPDATE "AttendanceDay" SET "lockedByPayrollRunId" = NULL WHERE "userId" = 'e5'`)
            await db.query(`DELETE FROM "PayrollRun" WHERE id = 'r5'`)
        }
    }, 120_000)
})
