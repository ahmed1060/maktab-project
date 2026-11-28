import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"

/**
 * Where a company's first policy and first schedule start unless changed
 * (LATER_CHANGES_PLAN.md §7.19; DESIGN.md §5.5, From when, for the policy
 * and the schedules): the first day of the payroll month today is in, by
 * when payroll closes, or the next month's where that month is approved.
 * Against a real Postgres built from the migrations, with a made-up
 * company, on 20 November 2026 in Cairo.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Made Up', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL);
`

const NOW = new Date("2026-11-20T08:00:00Z")

describe.skipIf(!ADMIN_URL)("where a company's first policy and schedule start, in Postgres", () => {
    const dbName = `first_from_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: NOW })
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        await root.query(`CREATE DATABASE ${dbName}`)
        await root.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        await root.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await root.end()
    })

    afterEach(async () => {
        await db.query(`DELETE FROM "PayrollRun" WHERE "companyId" = 'c1'`)
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = NULL WHERE id = 'c1'`)
    })

    it("is the calendar month's first day while payroll closes on the month's last day", async () => {
        expect(await Calendar.monthStart("c1")).toBe("2026-11-01")
    })

    it("is sent with the calendar, beside today", async () => {
        const calendar = await Calendar.calendar("c1", 2026)
        expect(calendar.today).toBe("2026-11-20")
        expect(calendar.monthStart).toBe("2026-11-01")
    })

    it("follows when payroll closes: the day after the month before's close", async () => {
        await db.query(`UPDATE "Company" SET "payrollCloseDay" = 24 WHERE id = 'c1'`)
        // The 20th is in November's payroll month, which began on 25 October.
        expect(await Calendar.monthStart("c1")).toBe("2026-10-25")
        // The 27th is past November's close, so in December's, which begins on the 25th.
        expect(await Calendar.monthStart("c1", "2026-11-27")).toBe("2026-11-25")
    })

    it("is the next month's first day where today's month is already approved", async () => {
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "periodStart", "periodEnd", "updatedAt")
            VALUES ('r11', 'c1', 11, 2026, 'APPROVED', 1, '2026-11-01', '2026-11-30', now())`)
        expect(await Calendar.monthStart("c1")).toBe("2026-12-01")
    })

    it("is not moved by a month still in draft", async () => {
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt")
            VALUES ('r11', 'c1', 11, 2026, 'DRAFT', 1, now())`)
        expect(await Calendar.monthStart("c1")).toBe("2026-11-01")
    })

    it("makes the first schedule the default from that day, so the whole month is measured", async () => {
        const from = await Calendar.monthStart("c1")
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: from, startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        const calendar = await Calendar.calendar("c1", 2026)
        expect(calendar.defaults.map(d => d.effectiveFrom)).toEqual(["2026-11-01"])
        expect(calendar.schedules[0].versions[0].effectiveFrom).toBe("2026-11-01")
    })
})
