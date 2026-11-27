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
 * 09:00 to 17:00 every working day but the 26th, absent, as Omar was.
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
            // Absent on the 26th, after November closes on the 24th.
            if (d !== "2026-11-26") rows.push(["1", dmy("09:00")], ["1", dmy("17:00")])
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

    it("refuses to approve a month before its period ends, saying from when", async () => {
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
        const out = await Payroll.approve("c1", 2026, 11, SESSION)
        expect(out).toEqual({ refusal: expect.objectContaining({ code: "PERIOD_NOT_OVER", from: "2026-12-01" }) })
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
        expect(await Payroll.approve("c1", 2026, 11, SESSION)).toHaveProperty("runId")
        expect(await run(11)).toEqual({ status: "APPROVED", from: "2026-10-25", to: "2026-11-24", payday: "2026-12-01", paydayChanged: false })
        expect(await frozen("2026-11-24")).toBe(true)
        expect(await frozen("2026-11-25")).toBe(false)
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
    })

    it("counts in a leaver's settlement their attendance after the leaving month's payroll closed, and nothing before it", async () => {
        const { SettlementService } = await import("@/lib/services/settlement.service")
        // Leaving on the 24th, the close: November's payroll counts every day.
        expect(await SettlementService.attendanceAfterClose("c1", "e1", 2026, 11, "2026-11-24")).toBe(0)
        // Leaving on the 26th: the 25th worked, the 26th absent, which December's payroll won't pay them for.
        const after = await SettlementService.attendanceAfterClose("c1", "e1", 2026, 11, "2026-11-26")
        expect(after).toBeLessThan(0)
        const absent = (await db.query(`SELECT "deductionMinor" FROM "AttendanceDay" WHERE "userId" = 'e1' AND date = '2026-11-26'`)).rows[0].deductionMinor
        expect(after).toBe(-absent)
    })

    it("changes a draft month's payday, ending its attendance the day before, the days after going to the next month", async () => {
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
        expect(await Payroll.changePayday("c1", 2026, 11, { payday: "2026-11-30" }, SESSION)).toEqual({ payday: "2026-11-30", periodEnd: "2026-11-24" })
        expect(await run(11)).toEqual(expect.objectContaining({ status: "APPROVED", to: "2026-11-24", payday: "2026-11-30", paydayChanged: true }))
        await db.query(`UPDATE "PayrollRun" SET status = 'PAID' WHERE "companyId" = 'c1' AND year = 2026 AND month = 11`)
        expect(await Payroll.changePayday("c1", 2026, 11, { payday: "2026-12-01" }, SESSION)).toEqual({ refused: expect.objectContaining({ code: "RUN_PAID" }) })
    })
})
