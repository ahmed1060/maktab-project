import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendanceEngineService as Engine } from "@/lib/services/attendance-engine.service"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"
import { addDays } from "@/lib/attendance/calendar"

/**
 * Public holidays off for a company, and back on, from a date
 * (FIRST_CHANGES_PLAN.md §6, PR 362), against a real Postgres built from the
 * migrations: what the engine makes of a public holiday while they're off,
 * the rules each change keeps, withdrawing one to come, and the audit log.
 *
 * September and October 2026: past months, worked out by the engine. August
 * 2026's payroll is approved. 10 September 2026 is a Thursday, a working day,
 * and made up as a public holiday here, as is 6 October. All names are made up.
 *
 * Needs ROLES_TEST_DATABASE_URL, like lib/roles.db.test.ts. Skipped without it.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Eman', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL);
`

const refusal = (code: string) => expect.objectContaining({ message: code })

describe.skipIf(!ADMIN_URL)("public holidays off for a company, in Postgres", () => {
    const dbName = `public_off_test_${Date.now()}`
    let db: Client
    let today = ""

    beforeAll(async () => {
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

        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run8', 'c1', 8, 2026, 'APPROVED', 25, now())`)
        // The migrations seed the real calendar: this database keeps only its two.
        await db.query(`DELETE FROM "PublicHoliday"`)
        await db.query(`INSERT INTO "PublicHoliday"(id, country, date, name, "updatedAt") VALUES ('ph1', 'EG', '2026-09-10', 'Test Day', now()), ('ph2', 'EG', '2026-10-06', 'Armed Forces Day', now())`)
        // Eman has the day off on 10 September.
        await db.query(`INSERT INTO "DayOffRequest"(id, "userId", type, status, date, "updatedAt") VALUES ('l1', 'e3', 'REGULAR', 'APPROVED', '2026-09-10T00:00:00Z', now())`)
        await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-09-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-09-01", body: STANDARD_OFFICE }, "a1")
        await Calendar.addHoliday("c1", { date: "2026-09-15", name: "Founders' Day" }, "a1")
        // One day of Ehab's scans, so the engine works the months out from then.
        await Punches.importRows("c1", { name: "sep.csv", hash: "sep", rows: [["AC-No.", "Name", "Check Time", "State"], ["1", "Ehab", "01/09/2026 09:00", "C/In"], ["1", "Ehab", "01/09/2026 17:00", "C/Out"]] }, { dateOrder: "DMY" }, "a1", true)
        await Punches.mapCode("c1", { code: "1", userId: "e1" }, "a1")
        today = await Calendar.today("c1")
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const day = async (userId: string, date: string) =>
        (await db.query(`SELECT status FROM "AttendanceDay" WHERE "userId" = $1 AND date = $2`, [userId, date])).rows[0]?.status as string | undefined
    const audit = async (action: string) =>
        (await db.query(`SELECT "entityType", "userId", details FROM "AuditLog" WHERE action = $1 ORDER BY "createdAt"`, [action])).rows

    it("applies them with no change, and the calendar says so, with the earliest a change may be from", async () => {
        expect(await day("e1", "2026-09-10")).toBe("HOLIDAY")
        expect(await day("e3", "2026-09-10")).toBe("HOLIDAY")
        const calendar = await Calendar.calendar("c1", 2026)
        expect(calendar.publicHolidays).toEqual({ changes: [], earliest: "2026-09-01" })
        expect(calendar.holidays.public.map(h => [h.date, h.applies])).toEqual([["2026-09-10", true], ["2026-10-06", true]])
    })

    it("refuses a change in an approved month, and one that changes nothing", async () => {
        await expect(Calendar.setPublicHolidays("c1", false, "2026-08-20", "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
        await expect(Calendar.setPublicHolidays("c1", true, "2026-09-01", "a1")).rejects.toEqual(refusal("PUBLIC_HOLIDAYS_ALREADY_ON"))
        await expect(Calendar.setPublicHolidays("c1", false, "2026-09-31", "a1")).rejects.toEqual(refusal("INVALID_DATE"))
        expect((await db.query(`SELECT count(*)::int AS n FROM "PublicHolidaysChange"`)).rows[0].n).toBe(0)
    })

    it("off: a public holiday is a workday, absent without scans and leave on a day off, and the company's own still applies", async () => {
        await Calendar.setPublicHolidays("c1", false, "2026-09-01", "a1")
        expect(await day("e1", "2026-09-10")).toBe("ABSENT")
        expect(await day("e3", "2026-09-10")).toBe("LEAVE")
        expect(await day("e1", "2026-09-15")).toBe("HOLIDAY")
        expect(await day("e1", "2026-10-06")).toBe("ABSENT")
        // What a person's day is expected to be, as the requests and the check-in read it.
        const { plans } = await Engine.plansFor("c1", ["e1"], ["2026-09-10", "2026-09-15"])
        expect(plans.get("e1")!.get("2026-09-10")!.kind).toBe("WORK")
        expect(plans.get("e1")!.get("2026-09-15")!.kind).toBe("HOLIDAY")
        expect(await audit("TURN_OFF_PUBLIC_HOLIDAYS")).toEqual([
            expect.objectContaining({ entityType: "ATTENDANCE_CALENDAR", userId: "a1", details: { companyId: "c1", effectiveFrom: "2026-09-01" } }),
        ])
        const calendar = await Calendar.calendar("c1", 2026)
        expect(calendar.holidays.public.map(h => h.applies)).toEqual([false, false])
        expect(calendar.publicHolidays.earliest).toBe("2026-09-02")
    })

    it("each change follows the last: from a later date, and the other way", async () => {
        await expect(Calendar.setPublicHolidays("c1", true, "2026-09-01", "a1")).rejects.toEqual(refusal("PUBLIC_HOLIDAYS_CHANGED_LATER"))
        await expect(Calendar.setPublicHolidays("c1", false, "2026-10-01", "a1")).rejects.toEqual(refusal("PUBLIC_HOLIDAYS_ALREADY_OFF"))
    })

    it("back on from a date: the days before it stay workdays, and the holidays after it are days off again", async () => {
        await Calendar.setPublicHolidays("c1", true, "2026-09-12", "a1")
        expect(await day("e1", "2026-09-10")).toBe("ABSENT")
        expect(await day("e1", "2026-10-06")).toBe("HOLIDAY")
        expect(await audit("TURN_ON_PUBLIC_HOLIDAYS")).toHaveLength(1)
        const calendar = await Calendar.calendar("c1", 2026)
        expect(calendar.holidays.public.map(h => [h.date, h.applies])).toEqual([["2026-09-10", false], ["2026-10-06", true]])
    })

    it("a change from a later date waits: another can't follow it until it's withdrawn, and one that has begun stays", async () => {
        const later = addDays(today, 20)
        await Calendar.setPublicHolidays("c1", false, later, "a1")
        await expect(Calendar.setPublicHolidays("c1", true, addDays(later, 5), "a1")).rejects.toEqual(refusal("PUBLIC_HOLIDAYS_CHANGE_TO_COME"))
        const { changes } = (await Calendar.calendar("c1", Number(later.slice(0, 4)))).publicHolidays
        expect(changes.map(c => [c.effectiveFrom, c.apply])).toEqual([["2026-09-01", false], ["2026-09-12", true], [later, false]])
        await expect(Calendar.withdrawPublicHolidaysChange(changes[1].id, "a1")).rejects.toEqual(refusal("PUBLIC_HOLIDAYS_CHANGE_BEGUN"))
        await Calendar.withdrawPublicHolidaysChange(changes[2].id, "a1")
        expect((await db.query(`SELECT count(*)::int AS n FROM "PublicHolidaysChange" WHERE "companyId" = 'c1'`)).rows[0].n).toBe(2)
        expect(await audit("WITHDRAW_PUBLIC_HOLIDAYS_CHANGE")).toEqual([expect.objectContaining({ details: { companyId: "c1", effectiveFrom: later } })])
        await expect(Calendar.withdrawPublicHolidaysChange(changes[2].id, "a1")).rejects.toEqual(refusal("PUBLIC_HOLIDAYS_CHANGE_NOT_FOUND"))
    })

    it("keeps one change a day for a company, and has Row Level Security on, as every table does", async () => {
        await expect(db.query(`INSERT INTO "PublicHolidaysChange"(id, "companyId", "effectiveFrom", apply, "createdById") VALUES ('x', 'c1', '2026-09-12', false, 'a1')`)).rejects.toThrow(/unique/)
        expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'PublicHolidaysChange'`)).rows[0].relrowsecurity).toBe(true)
        // Another company's public holidays are its own: nothing changed for it.
        expect((await db.query(`SELECT count(*)::int AS n FROM "PublicHolidaysChange" WHERE "companyId" = 'c2'`)).rows[0].n).toBe(0)
    })
})
