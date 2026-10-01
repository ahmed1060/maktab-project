import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { PublicHolidayService } from "@/lib/services/public-holiday.service"

/**
 * The attendance calendar's rules, against a real Postgres built from the
 * migration files (ATTENDANCE_PLAN.md §6.1, §7). The rules that span rows —
 * one default, no overlapping overrides, nothing inside an approved payroll
 * month — and the database's own CHECKs cannot be shown without one.
 *
 * Needs ROLES_TEST_DATABASE_URL (a maintenance database it may create
 * databases on), like lib/roles.db.test.ts. Skipped without it.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

/** People as they stood before roles were data; the roles migration gives them their roles. */
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Eman', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Essam', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2', NULL);
`

const HOURS = { startMinutes: 540, endMinutes: 1020, breakMinutes: 60 }

describe.skipIf(!ADMIN_URL)("the attendance calendar, in Postgres", () => {
    const dbName = `calendar_test_${Date.now()}`
    let db: Client

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
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sa@x', 'p', 'Sam', 'Admin', 'sa', now())`)
        // September 2026's payroll is approved: its calendar is settled.
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run9', 'c1', 9, 2026, 'APPROVED', 25, now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 120_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const refusal = (code: string) => expect.objectContaining({ message: code })

    describe("schedules", () => {
        it("makes the company's first schedule its default, and only that one", async () => {
            const office = await Calendar.createSchedule("c1", { name: "Office", version: { ...HOURS, effectiveFrom: "2026-10-01" } }, "a1")
            const warehouse = await Calendar.createSchedule("c1", {
                name: "Warehouse", version: { ...HOURS, startMinutes: 420, endMinutes: 900, effectiveFrom: "2026-10-01", workWeek: [6, 0, 1, 2, 3, 4] },
            }, "a1")
            expect(office.isDefault).toBe(true)
            expect(warehouse.isDefault).toBe(false)
            expect(warehouse.versions[0].workWeek).toEqual([0, 1, 2, 3, 4, 6])
        })

        it("refuses a second schedule of the same name in one company, not across companies", async () => {
            await expect(Calendar.createSchedule("c1", { name: "Office", version: { ...HOURS, effectiveFrom: "2026-10-01" } }, "a1")).rejects.toEqual(refusal("SCHEDULE_NAME_TAKEN"))
            const other = await Calendar.createSchedule("c2", { name: "Office", version: { ...HOURS, effectiveFrom: "2026-10-01" } }, "a1")
            expect(other.isDefault).toBe(true)
        })

        it("moves the default when another is made default, and never leaves none", async () => {
            const { rows: [warehouse] } = await db.query(`SELECT id FROM "WorkSchedule" WHERE "companyId" = 'c1' AND name = 'Warehouse'`)
            const { rows: [office] } = await db.query(`SELECT id FROM "WorkSchedule" WHERE "companyId" = 'c1' AND name = 'Office'`)
            await Calendar.updateSchedule(warehouse.id, { isDefault: true }, "a1")
            const { rows } = await db.query(`SELECT name FROM "WorkSchedule" WHERE "companyId" = 'c1' AND "isDefault"`)
            expect(rows).toEqual([{ name: "Warehouse" }])
            await expect(Calendar.updateSchedule(warehouse.id, { isDefault: false }, "a1")).rejects.toEqual(refusal("SCHEDULE_DEFAULT_REQUIRED"))
            await expect(Calendar.archiveSchedule(warehouse.id, "a1")).rejects.toEqual(refusal("SCHEDULE_IS_DEFAULT"))
            await Calendar.updateSchedule(office.id, { isDefault: true }, "a1")
        })

        it("is held to one default by the database too", async () => {
            await expect(db.query(`UPDATE "WorkSchedule" SET "isDefault" = true WHERE "companyId" = 'c1'`)).rejects.toThrow(/WorkSchedule_one_default/)
        })
    })

    describe("changing hours from a date (§6.1)", () => {
        const office = async () => (await db.query(`SELECT id FROM "WorkSchedule" WHERE "companyId" = 'c1' AND name = 'Office'`)).rows[0].id as string

        it("adds a version from the date asked, keeping the earlier one", async () => {
            const after = await Calendar.addVersion(await office(), { ...HOURS, startMinutes: 480, endMinutes: 960, effectiveFrom: "2026-11-01" }, "a1")
            expect(after.versions.map(v => [v.effectiveFrom, v.startMinutes])).toEqual([["2026-10-01", 540], ["2026-11-01", 480]])
        })

        it("refuses two versions on one date", async () => {
            await expect(Calendar.addVersion(await office(), { ...HOURS, effectiveFrom: "2026-11-01" }, "a1")).rejects.toEqual(refusal("VERSION_DATE_TAKEN"))
        })

        it("refuses a version inside a month whose payroll is approved", async () => {
            await expect(Calendar.addVersion(await office(), { ...HOURS, effectiveFrom: "2026-09-15" }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            // Another company's approved month is not this one's.
            await expect(Calendar.addVersion(await office(), { ...HOURS, effectiveFrom: "2026-12-01" }, "a1")).resolves.toBeTruthy()
        })

        it("refuses hours that are not a shift, before the database has to", async () => {
            await expect(Calendar.addVersion(await office(), { startMinutes: 600, endMinutes: 540, effectiveFrom: "2027-01-01" }, "a1")).rejects.toEqual(refusal("END_NOT_AFTER_START"))
            await expect(Calendar.addVersion(await office(), { ...HOURS, effectiveFrom: "2027-02-30" }, "a1")).rejects.toEqual(refusal("INVALID_DATE"))
            await expect(Calendar.addVersion(await office(), { ...HOURS, effectiveFrom: "2027-01-01", workWeek: [0, 9] }, "a1")).rejects.toEqual(refusal("WORK_WEEK_INVALID_DAY"))
        })

        it("is held by the database's CHECKs too", async () => {
            await expect(db.query(`INSERT INTO "ScheduleVersion"(id, "scheduleId", "effectiveFrom", "createdById", "startMinutes", "endMinutes") VALUES ('bad', '${await office()}', '2027-03-01', 'a1', 600, 540)`)).rejects.toThrow(/ScheduleVersion_hours/)
            await expect(db.query(`INSERT INTO "ScheduleVersion"(id, "scheduleId", "effectiveFrom", "createdById", "startMinutes", "endMinutes", "workWeek") VALUES ('bad', '${await office()}', '2027-03-01', 'a1', 540, 1020, '{7}')`)).rejects.toThrow(/ScheduleVersion_workWeek/)
        })

        it("withdraws a version, but never a schedule's last", async () => {
            const { rows: [dec] } = await db.query(`SELECT v.id FROM "ScheduleVersion" v JOIN "WorkSchedule" s ON s.id = v."scheduleId" WHERE s.name = 'Office' AND s."companyId" = 'c1' AND v."effectiveFrom" = '2026-12-01'`)
            await Calendar.deleteVersion(dec.id, "a1")
            const { rows: [only] } = await db.query(`SELECT v.id FROM "ScheduleVersion" v JOIN "WorkSchedule" s ON s.id = v."scheduleId" WHERE s."companyId" = 'c2'`)
            await expect(Calendar.deleteVersion(only.id, "a1")).rejects.toEqual(refusal("LAST_VERSION"))
        })
    })

    describe("seasonal hours (§7.1)", () => {
        const office = async () => (await db.query(`SELECT id FROM "WorkSchedule" WHERE "companyId" = 'c1' AND name = 'Office'`)).rows[0].id as string
        const RAMADAN = { name: "Ramadan 2027", startDate: "2027-02-08", endDate: "2027-03-09", startMinutes: 600, endMinutes: 900 }

        it("lays dated hours over a schedule, never two on one day", async () => {
            const s = await Calendar.createOverride(await office(), RAMADAN, "a1")
            expect(s.overrides.map(o => [o.name, o.startDate, o.endDate])).toEqual([["Ramadan 2027", "2027-02-08", "2027-03-09"]])
            await expect(Calendar.createOverride(await office(), { ...RAMADAN, name: "Overlap", startDate: "2027-03-09", endDate: "2027-03-12" }, "a1")).rejects.toEqual(refusal("OVERRIDE_OVERLAPS"))
        })

        it("moves when Ramadan's dates are confirmed, without colliding with itself", async () => {
            const { rows: [o] } = await db.query(`SELECT id FROM "ScheduleOverride" WHERE name = 'Ramadan 2027'`)
            const s = await Calendar.updateOverride(o.id, { ...RAMADAN, startDate: "2027-02-07", endDate: "2027-03-08" }, "a1")
            expect(s.overrides[0]).toMatchObject({ startDate: "2027-02-07", endDate: "2027-03-08" })
        })

        it("cannot reach into an approved month, from either end", async () => {
            await expect(Calendar.createOverride(await office(), { ...RAMADAN, name: "Summer", startDate: "2026-08-20", endDate: "2026-10-05" }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await expect(Calendar.createOverride(await office(), { ...RAMADAN, name: "Backwards", startDate: "2027-05-10", endDate: "2027-05-01" }, "a1")).rejects.toEqual(refusal("OVERRIDE_ENDS_BEFORE_START"))
        })
    })

    describe("who works which", () => {
        const id = async (name: string, company = "c1") => (await db.query(`SELECT id FROM "WorkSchedule" WHERE "companyId" = '${company}' AND name = '${name}'`)).rows[0].id as string

        it("puts people on a schedule from a date, replacing a move on the same date", async () => {
            await Calendar.assign("c1", { userIds: ["e1", "e3"], scheduleId: await id("Office"), effectiveFrom: "2026-11-01" }, "a1")
            await Calendar.assign("c1", { userIds: ["e1"], scheduleId: await id("Warehouse"), effectiveFrom: "2026-11-01" }, "a1")
            const { rows } = await db.query(`SELECT u."userId", s.name FROM "UserSchedule" u JOIN "WorkSchedule" s ON s.id = u."scheduleId" ORDER BY u."userId"`)
            expect(rows).toEqual([{ userId: "e1", name: "Warehouse" }, { userId: "e3", name: "Office" }])
        })

        it("refuses somebody from another company, another company's schedule, and a locked month", async () => {
            await expect(Calendar.assign("c1", { userIds: ["e2"], scheduleId: await id("Office"), effectiveFrom: "2026-11-01" }, "a1")).rejects.toEqual(refusal("USER_NOT_IN_COMPANY"))
            await expect(Calendar.assign("c1", { userIds: ["e1"], scheduleId: await id("Office", "c2"), effectiveFrom: "2026-11-01" }, "a1")).rejects.toEqual(refusal("SCHEDULE_NOT_FOUND"))
            await expect(Calendar.assign("c1", { userIds: ["e1"], scheduleId: await id("Office"), effectiveFrom: "2026-09-01" }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
        })

        it("will not archive a schedule somebody is on now or later", async () => {
            await expect(Calendar.archiveSchedule(await id("Warehouse"), "a1")).rejects.toEqual(refusal("SCHEDULE_IN_USE"))
            const { rows: [move] } = await db.query(`SELECT id FROM "UserSchedule" WHERE "userId" = 'e1'`)
            await Calendar.removeAssignment(move.id, "a1")
            await Calendar.archiveSchedule(await id("Warehouse"), "a1")
            await expect(Calendar.assign("c1", { userIds: ["e1"], scheduleId: await id("Warehouse"), effectiveFrom: "2026-12-01" }, "a1")).rejects.toEqual(refusal("SCHEDULE_ARCHIVED"))
        })
    })

    describe("holidays (§7.2)", () => {
        it("starts every company on the central calendar, all observed", async () => {
            const cal = await Calendar.calendar("c1", 2026)
            expect(cal.holidays.public.map(h => h.date)).toEqual(["2026-01-07", "2026-01-25", "2026-04-25", "2026-05-01", "2026-06-30", "2026-07-23", "2026-10-06"])
            expect(cal.holidays.public.every(h => h.observed)).toBe(true)
        })

        it("keeps a company opted out of a holiday when the Super Admin moves it", async () => {
            const { rows: [armed] } = await db.query(`SELECT id FROM "PublicHoliday" WHERE date = '2026-10-06'`)
            await Calendar.setObserved("c1", armed.id, false, "a1")
            // A decree moves it to the Thursday.
            await PublicHolidayService.update(armed.id, { date: "2026-10-08", name: "Armed Forces Day" }, "sa")
            const c1 = await Calendar.calendar("c1", 2026)
            const c2 = await Calendar.calendar("c2", 2026)
            expect(c1.holidays.public.find(h => h.id === armed.id)).toMatchObject({ date: "2026-10-08", observed: false })
            expect(c2.holidays.public.find(h => h.id === armed.id)).toMatchObject({ date: "2026-10-08", observed: true })
            await Calendar.setObserved("c1", armed.id, true, "a1")
            expect((await Calendar.calendar("c1", 2026)).holidays.public.find(h => h.id === armed.id)?.observed).toBe(true)
        })

        it("adds the company's own days, one per date, and not inside an approved month", async () => {
            await Calendar.addHoliday("c1", { date: "2026-11-15", name: "Founding day" }, "a1")
            await expect(Calendar.addHoliday("c1", { date: "2026-11-15", name: "Again" }, "a1")).rejects.toEqual(refusal("HOLIDAY_DATE_TAKEN"))
            await expect(Calendar.addHoliday("c1", { date: "2026-09-10", name: "Late" }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            expect((await Calendar.calendar("c1", 2026)).holidays.own).toEqual([expect.objectContaining({ date: "2026-11-15", name: "Founding day", isPaid: true })])
            expect((await Calendar.calendar("c2", 2026)).holidays.own).toEqual([])
        })

        it("refuses a second public holiday on one date", async () => {
            await expect(PublicHolidayService.create({ date: "2026-05-01", name: "Duplicate" }, "sa")).rejects.toEqual(refusal("HOLIDAY_DATE_TAKEN"))
        })
    })

    it("writes every change to the audit log, as the person who made it", async () => {
        const { rows } = await db.query(`SELECT action, "entityType", "userId", "superAdminId" FROM "AuditLog" WHERE "entityType" IN ('ATTENDANCE_CALENDAR', 'PUBLIC_HOLIDAY')`)
        const actions = new Set(rows.map(r => r.action))
        for (const a of ["CREATE_WORK_SCHEDULE", "UPDATE_WORK_SCHEDULE", "CREATE_SCHEDULE_VERSION", "DELETE_SCHEDULE_VERSION", "CREATE_SCHEDULE_OVERRIDE",
            "UPDATE_SCHEDULE_OVERRIDE", "ASSIGN_WORK_SCHEDULE", "UNASSIGN_WORK_SCHEDULE", "ARCHIVE_WORK_SCHEDULE", "SKIP_PUBLIC_HOLIDAY",
            "OBSERVE_PUBLIC_HOLIDAY", "CREATE_COMPANY_HOLIDAY", "UPDATE_PUBLIC_HOLIDAY"]) {
            expect(actions, a).toContain(a)
        }
        expect(rows.filter(r => r.entityType === "ATTENDANCE_CALENDAR").every(r => r.userId === "a1" && r.superAdminId === null)).toBe(true)
    })
})
