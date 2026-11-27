import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * Asking for a day off within its days, against a real Postgres built from
 * the migrations (LATER_CHANGES_PLAN.md §7.4, 4a).
 *
 * The clock is held at 10:00 on Friday 27 November 2026 in Cairo. One, with
 * Attendance, has September paid and October approved, and a policy from 1 October
 * saved before the months ahead existed; Two has Day off without
 * Attendance, and no payroll approved.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2');
`

const NOW = new Date("2026-11-27T08:00:00Z")
const asker = (id: string, companyId: string) => ({ user: { id, companyId, name: "Made Up", role: "EMPLOYEE" } })

describe.skipIf(!ADMIN_URL)("asking for a day off within its days, in Postgres", () => {
    const dbName = `day_off_limits_test_${Date.now()}`
    let db: Client
    let url: URL
    let DayOff: typeof import("@/lib/services/day-off.service")
    const policy = (id: string, companyId: string, from: string, body: object) =>
        db.query(`INSERT INTO "AttendancePolicy"(id, "companyId", "effectiveFrom", body, "createdById") VALUES ($1, $2, $3, $4, 'e1')`, [id, companyId, from, JSON.stringify(body)])
    const asked = async (userId: string) => (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM "DayOffRequest" WHERE "userId" = $1 ORDER BY date`, [userId])).rows.map(r => r.d)

    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: NOW })
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
        DayOff = await import("@/lib/services/day-off.service")

        // A policy saved before the months ahead: it reads as 1.
        const before: Record<string, unknown> = { ...STANDARD_OFFICE }
        delete before.dayOffMonthsAhead
        await policy("p1", "c1", "2026-10-01", before)
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "periodStart", "periodEnd", "updatedAt") VALUES
            ('r9', 'c1', 9, 2026, 'PAID', 1, '2026-09-01', '2026-09-30', now()),
            ('r10', 'c1', 10, 2026, 'APPROVED', 1, '2026-10-01', '2026-10-31', now()),
            ('r11', 'c1', 11, 2026, 'DRAFT', 1, NULL, NULL, now())`)
        // Two has HR, so Day off, and neither attendance add-on.
        await db.query(`INSERT INTO "Package"(id, name, "hasHR", "updatedAt") VALUES ('hr-only', 'HR only', true, now())`)
        await db.query(`UPDATE "Company" SET "packageId" = 'hr-only' WHERE id = 'c2'`)
        await policy("p2", "c2", "2026-10-01", { ...STANDARD_OFFICE, dayOffMonthsAhead: 6 })
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

    it("run from the day after the approved month's period to today plus the policy in force's months ahead", async () => {
        const { DayOffService } = DayOff
        expect(await DayOffService.window("c1")).toEqual({ from: "2026-11-01", to: "2026-12-27" })
        // A version from 1 November, in force today, says 3; one from 1 December, not yet, says 12.
        await policy("p1b", "c1", "2026-11-01", { ...STANDARD_OFFICE, dayOffMonthsAhead: 3 })
        await policy("p1c", "c1", "2026-12-01", { ...STANDARD_OFFICE, dayOffMonthsAhead: 12 })
        expect(await DayOffService.window("c1")).toEqual({ from: "2026-11-01", to: "2027-02-27" })
        // Without Attendance, 1 whatever its policy says; with no payroll approved, from the 1st of last month.
        expect(await DayOffService.window("c2")).toEqual({ from: "2026-10-01", to: "2026-12-27" })
    })

    it("go by the company's day, not UTC's", async () => {
        const { DayOffService } = DayOff
        // 23:00 on 30 November in UTC is 1 December in Cairo.
        vi.setSystemTime(new Date("2026-11-30T23:00:00Z"))
        try {
            expect(await DayOffService.window("c2")).toEqual({ from: "2026-11-01", to: "2027-01-01" })
        } finally {
            vi.setSystemTime(NOW)
        }
    })

    it("refuses a day outside them, saying which days may be asked for, and takes one inside, a day passed too", async () => {
        const { DayOffService, DayOffOutOfRange } = DayOff
        const before = DayOffService.create({ date: "2026-10-31", type: "CASUAL" }, asker("e1", "c1"))
        await expect(before).rejects.toBeInstanceOf(DayOffOutOfRange)
        await expect(before).rejects.toMatchObject({ message: "DAY_OFF_OUT_OF_RANGE", from: "2026-11-01", to: "2027-02-27" })
        // A range ending after the last day.
        await expect(DayOffService.create({ date: "2027-02-26", endDate: "2027-02-28", type: "REGULAR" }, asker("e1", "c1"))).rejects.toMatchObject({ message: "DAY_OFF_OUT_OF_RANGE" })
        await DayOffService.create({ date: "2026-11-02", type: "SICK" }, asker("e1", "c1"))
        await DayOffService.create({ date: "2027-02-25", endDate: "2027-02-27", type: "REGULAR" }, asker("e1", "c1"))
        await DayOffService.create({ date: "2026-11-01", type: "CASUAL" }, asker("e1", "c1"))
        // A one-day type is that day, whatever end is sent with it.
        await DayOffService.create({ date: "2026-12-01", endDate: "2027-12-01", type: "CASUAL" }, asker("e1", "c1"))
        expect(await asked("e1")).toEqual(["2026-11-01", "2026-11-02", "2026-12-01", "2027-02-25"])
        // Two's: from 1 October, its 1st of last month, to 27 December.
        await expect(DayOffService.create({ date: "2026-12-28", type: "CASUAL" }, asker("e2", "c2"))).rejects.toMatchObject({ from: "2026-10-01", to: "2026-12-27" })
        await DayOffService.create({ date: "2026-10-01", type: "CASUAL" }, asker("e2", "c2"))
        expect(await asked("e2")).toEqual(["2026-10-01"])
    })

    it("reads them holding the locks of the months its days fall in, so approving one meanwhile waits", async () => {
        const { DayOffService } = DayOff
        const other = new Client({ connectionString: url.toString() })
        await other.connect()
        const held: boolean[] = []
        const window = DayOffService.window.bind(DayOffService)
        const spy = vi.spyOn(DayOffService, "window").mockImplementation(async (...args) => {
            // The look under the locks, given the transaction; not the first look before them.
            if (args[1]) for (const month of ["2026-11", "2026-12"]) {
                const { rows } = await other.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS got`, [`attendance-month:c1:${month}`])
                held.push(!rows[0].got)
                if (rows[0].got) await other.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`attendance-month:c1:${month}`])
            }
            return window(...args)
        })
        try {
            await DayOffService.create({ date: "2026-11-30", type: "CASUAL" }, asker("e1", "c1"))
            expect(held).toEqual([true, true])
        } finally {
            spy.mockRestore()
            await other.end()
        }
    })

    it("refuses days far outside them at once, before listing them or locking their months (Codex review on #431)", async () => {
        const { DayOffService } = DayOff
        const started = performance.now()
        await expect(DayOffService.create({ date: "2026-11-03", endDate: "9998-12-31", type: "REGULAR" }, asker("e1", "c1"))).rejects.toMatchObject({ message: "DAY_OFF_OUT_OF_RANGE", from: "2026-11-01", to: "2027-02-27" })
        await expect(DayOffService.create({ date: "0001-01-01", endDate: "2026-11-03", type: "REGULAR" }, asker("e1", "c1"))).rejects.toMatchObject({ message: "DAY_OFF_OUT_OF_RANGE", from: "2026-11-01", to: "2027-02-27" })
        expect(performance.now() - started).toBeLessThan(3000)
    }, 120_000)

    it("goes by the look under the locks, whatever the first look before them said", async () => {
        const { DayOffService } = DayOff
        const window = DayOffService.window.bind(DayOffService)
        // The first look, before any lock, says more days than there are by the time the locks are held.
        const spy = vi.spyOn(DayOffService, "window").mockImplementation(async (...args) => args[1] ? window(...args) : { from: "2000-01-01", to: "2099-12-31" })
        try {
            await expect(DayOffService.create({ date: "2026-10-30", type: "CASUAL" }, asker("e1", "c1"))).rejects.toMatchObject({ message: "DAY_OFF_OUT_OF_RANGE", from: "2026-11-01", to: "2027-02-27" })
            await expect(DayOffService.create({ date: "2027-02-28", type: "CASUAL" }, asker("e1", "c1"))).rejects.toMatchObject({ message: "DAY_OFF_OUT_OF_RANGE", from: "2026-11-01", to: "2027-02-27" })
        } finally {
            spy.mockRestore()
        }
        expect(await asked("e1")).not.toContain("2026-10-30")
        expect(await asked("e1")).not.toContain("2027-02-28")
    })

    it("waits behind an import holding a month's lock longer than five seconds, then is taken (Codex review on #431)", async () => {
        const { DayOffService } = DayOff
        const importing = new Client({ connectionString: url.toString() })
        await importing.connect()
        try {
            await importing.query("BEGIN")
            await importing.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["attendance-month:c1:2026-12"])
            const asking = DayOffService.create({ date: "2026-12-02", type: "CASUAL" }, asker("e1", "c1")).then(() => "taken", (e: Error) => e.message)
            await new Promise(resolve => setTimeout(resolve, 6000))
            await importing.query("COMMIT")
            expect(await asking).toBe("taken")
            expect(await asked("e1")).toContain("2026-12-02")
        } finally {
            await importing.end()
        }
    }, 30_000)

    it("refuses a day a final settlement counted, as for a month paid", async () => {
        const { DayOffService } = DayOff
        await db.query(`INSERT INTO "FinalSettlement"(id, "userId", "companyId", "lastWorkingDay", "earnedAmount", "netAmount", "dueDate", "updatedAt") VALUES
            ('fs1', 'e2', 'c2', '2026-11-20T00:00:00Z', 0, 0, '2026-12-01T00:00:00Z', now())`)
        await db.query(`INSERT INTO "AttendanceDay"(id, "companyId", "userId", date, status, breakdown, "inputsHash", "lockedBySettlementId") VALUES
            ('d1', 'c2', 'e2', '2026-11-19', 'PRESENT', '{}', 'x', 'fs1')`)
        await expect(DayOffService.create({ date: "2026-11-18", endDate: "2026-11-19", type: "REGULAR" }, asker("e2", "c2"))).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        expect(await asked("e2")).toEqual(["2026-10-01"])
    })
})
