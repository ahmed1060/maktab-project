import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { PublicHolidayService } from "@/lib/services/public-holiday.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE, SIX_DAY_FACTORY } from "@/lib/attendance/policy"
import { addDays, scheduleIdOn } from "@/lib/attendance/calendar"

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
        const defaultsOf = async (company: string) =>
            (await db.query(`SELECT s.name, d."effectiveFrom"::text AS "from" FROM "ScheduleDefault" d JOIN "WorkSchedule" s ON s.id = d."scheduleId" WHERE d."companyId" = '${company}' ORDER BY d."effectiveFrom"`)).rows
        const id = async (name: string, company = "c1") => (await db.query(`SELECT id FROM "WorkSchedule" WHERE "companyId" = '${company}' AND name = '${name}'`)).rows[0].id as string

        it("makes the company's first schedule its default from its first day, and only that one", async () => {
            await Calendar.createSchedule("c1", { name: "Office", version: { ...HOURS, effectiveFrom: "2026-10-01" } }, "a1")
            const warehouse = await Calendar.createSchedule("c1", {
                name: "Warehouse", version: { ...HOURS, startMinutes: 420, endMinutes: 900, effectiveFrom: "2026-10-01", workWeek: [6, 0, 1, 2, 3, 4] },
            }, "a1")
            expect(await defaultsOf("c1")).toEqual([{ name: "Office", from: "2026-10-01" }])
            expect(warehouse.versions[0].workWeek).toEqual([0, 1, 2, 3, 4, 6])
        })

        it("refuses a second schedule of the same name in one company, not across companies", async () => {
            await expect(Calendar.createSchedule("c1", { name: "Office", version: { ...HOURS, effectiveFrom: "2026-10-01" } }, "a1")).rejects.toEqual(refusal("SCHEDULE_NAME_TAKEN"))
            await Calendar.createSchedule("c2", { name: "Office", version: { ...HOURS, effectiveFrom: "2026-10-01" } }, "a1")
            expect(await defaultsOf("c2")).toEqual([{ name: "Office", from: "2026-10-01" }])
        })

        it("makes another schedule the default from a date, never before it (review on #10)", async () => {
            await Calendar.setDefault(await id("Warehouse"), "2026-11-01", "a1")
            expect(await defaultsOf("c1")).toEqual([{ name: "Office", from: "2026-10-01" }, { name: "Warehouse", from: "2026-11-01" }])
            const { defaults } = await Calendar.calendar("c1", 2026)
            expect(scheduleIdOn([], defaults, "2026-10-31")).toBe(await id("Office"))
            expect(scheduleIdOn([], defaults, "2026-11-01")).toBe(await id("Warehouse"))
            // A schedule that becomes the default later cannot be archived meanwhile.
            await expect(Calendar.archiveSchedule(await id("Warehouse"), "a1")).rejects.toEqual(refusal("SCHEDULE_IS_DEFAULT"))
        })

        it("refuses a default change whose span reaches an approved month", async () => {
            // September is approved. A change on 1 August would govern it up to 1 October.
            await expect(Calendar.setDefault(await id("Warehouse"), "2026-08-01", "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await expect(Calendar.setDefault(await id("Warehouse"), "2026-09-15", "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            expect((await defaultsOf("c1")).length).toBe(2)
        })

        it("doesn't make a schedule archived meanwhile the default (review on #64)", async () => {
            await Calendar.createSchedule("c1", { name: "Relief", version: { ...HOURS, effectiveFrom: "2026-10-01" } }, "a1")
            const spare = await id("Relief")
            // An archive under way holds the schedule's lock, and commits once the change of default has read the schedule.
            await db.query("BEGIN")
            await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))::text`, [`schedule:${spare}`])
            const setting = Calendar.setDefault(spare, "2026-12-01", "a1").then(() => "SET", (e: Error) => e.message)
            // Until the change waits on that lock, or has gone ahead without it.
            for (let i = 0; i < 40; i++) {
                if ((await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n > 0) break
                await new Promise(r => setTimeout(r, 50))
            }
            await db.query(`UPDATE "WorkSchedule" SET "archivedAt" = now() WHERE id = $1`, [spare])
            await db.query("COMMIT")
            expect(await setting).toBe("SCHEDULE_ARCHIVED")
            expect((await defaultsOf("c1")).map(d => d.name)).not.toContain("Relief")
        })

        it("withdraws a later change of default, never the first", async () => {
            const rows = (await db.query(`SELECT id, "effectiveFrom"::text AS "from" FROM "ScheduleDefault" WHERE "companyId" = 'c1' ORDER BY "effectiveFrom"`)).rows
            await expect(Calendar.withdrawDefault(rows[0].id, "a1")).rejects.toEqual(refusal("SCHEDULE_DEFAULT_REQUIRED"))
            await Calendar.withdrawDefault(rows[1].id, "a1")
            expect(await defaultsOf("c1")).toEqual([{ name: "Office", from: "2026-10-01" }])
        })

        it("holds one default per date in the database too", async () => {
            const office = await id("Office")
            await expect(db.query(`INSERT INTO "ScheduleDefault"(id, "companyId", "scheduleId", "effectiveFrom", "createdById") VALUES ('dup', 'c1', '${office}', '2026-10-01', 'a1')`)).rejects.toThrow(/ScheduleDefault_companyId_effectiveFrom_key/)
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

        it("refuses a version that starts in an open month but governs an approved one (review on #10)", async () => {
            // Office's first hours start on 1 October; hours from 1 July would govern September.
            await expect(Calendar.addVersion(await office(), { ...HOURS, effectiveFrom: "2026-07-01" }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            // And withdrawing one that governs it would hand September back to the hours before it.
            await db.query(`INSERT INTO "ScheduleVersion"(id, "scheduleId", "effectiveFrom", "createdById", "startMinutes", "endMinutes") VALUES ('aug', '${await office()}', '2026-08-01', 'a1', 540, 1020)`)
            await expect(Calendar.deleteVersion("aug", "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await db.query(`DELETE FROM "ScheduleVersion" WHERE id = 'aug'`)
        })

        it("refuses a short day that is not longer than the break (review on #10)", async () => {
            await expect(Calendar.addVersion(await office(), { ...HOURS, effectiveFrom: "2027-01-04", days: [{ weekday: 4, startMinutes: 540, endMinutes: 570 }] }, "a1")).rejects.toEqual(refusal("BREAK_TOO_LONG"))
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

        it("lets only one of two overlapping overrides through when they race (review on #10)", async () => {
            const results = await Promise.allSettled([
                Calendar.createOverride(await office(), { ...RAMADAN, name: "Race A", startDate: "2027-06-01", endDate: "2027-06-10" }, "a1"),
                Calendar.createOverride(await office(), { ...RAMADAN, name: "Race B", startDate: "2027-06-05", endDate: "2027-06-15" }, "a1"),
            ])
            expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"])
            expect((await db.query(`SELECT count(*)::int AS n FROM "ScheduleOverride" WHERE name LIKE 'Race %'`)).rows[0].n).toBe(1)
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

        it("refuses a move that starts in an open month but governs an approved one (review on #10)", async () => {
            // Eman moves to Office on 1 November; a move on 1 August would govern September.
            await expect(Calendar.assign("c1", { userIds: ["e3"], scheduleId: await id("Warehouse"), effectiveFrom: "2026-08-01" }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await db.query(`INSERT INTO "UserSchedule"(id, "userId", "scheduleId", "effectiveFrom", "createdById") VALUES ('aug-move', 'e3', '${await id("Warehouse")}', '2026-08-15', 'a1')`)
            await expect(Calendar.removeAssignment("aug-move", "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await db.query(`DELETE FROM "UserSchedule" WHERE id = 'aug-move'`)
        })

        it("leaves somebody's old company's schedule behind when they move company (review on #10)", async () => {
            const move = (company: string) => db.query(`UPDATE "User" SET "companyId" = '${company}', "roleId" = (SELECT id FROM "Role" WHERE "companyId" = '${company}' AND "builtIn" = 'EMPLOYEE') WHERE id = 'e3'`)
            await move("c2")
            const there = await Calendar.calendar("c2", 2026)
            expect(there.assignments.filter(a => a.userId === "e3")).toEqual([])
            expect((await Calendar.calendar("c1", 2026)).assignments.some(a => a.userId === "e3")).toBe(false)
            await move("c1")
        })

        it("does not let somebody who has left hold a schedule open (review on #10)", async () => {
            await Calendar.createSchedule("c1", { name: "Spare", version: { ...HOURS, effectiveFrom: "2026-10-01" } }, "a1")
            await Calendar.assign("c1", { userIds: ["e3"], scheduleId: await id("Spare"), effectiveFrom: "2027-02-01" }, "a1")
            await expect(Calendar.archiveSchedule(await id("Spare"), "a1")).rejects.toEqual(refusal("SCHEDULE_IN_USE"))
            await db.query(`UPDATE "User" SET status = 'ARCHIVED' WHERE id = 'e3'`)
            await Calendar.archiveSchedule(await id("Spare"), "a1")
            await db.query(`UPDATE "User" SET status = 'OFFLINE' WHERE id = 'e3'`)
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

    describe("the policy (§6)", () => {
        it("starts from a seeded template, copied, with the template named but not linked", async () => {
            const today = await Calendar.today("c1")
            const templates = await Policy.templates()
            expect(templates.map(t => t.name)).toEqual(["Six-day factory", "Standard Egyptian office"])
            const standard = templates.find(t => t.name === "Standard Egyptian office")!
            await Policy.saveVersion("c1", { effectiveFrom: today, body: standard.body, appliedTemplateId: standard.id }, "a1")
            const [v] = await Policy.versions("c1")
            expect(v).toMatchObject({ effectiveFrom: today, appliedTemplateId: standard.id, body: STANDARD_OFFICE })
            // Editing the template afterwards changes nobody's policy.
            await Policy.updateTemplate(standard.id, { name: standard.name, body: { ...STANDARD_OFFICE, absence: { multiplier: 2 } } }, "sa")
            expect((await Policy.versions("c1"))[0].body.absence.multiplier).toBe(1)
        })

        it("gives the calendar the company's working days from the policy in force", async () => {
            expect((await Calendar.calendar("c1", 2026)).companyWorkWeek).toEqual([0, 1, 2, 3, 4])
            expect((await Calendar.calendar("c2", 2026)).companyWorkWeek).toEqual([0, 1, 2, 3, 4])
            // And every change of it, for versions that start later (review on #11).
            expect((await Calendar.calendar("c1", 2026)).companyWorkWeeks).toEqual([{ effectiveFrom: await Calendar.today("c1"), workWeek: [0, 1, 2, 3, 4] }])
            expect((await Calendar.calendar("c2", 2026)).companyWorkWeeks).toEqual([])
        })

        it("replaces a version not yet in force, and never one that is", async () => {
            const today = await Calendar.today("c1")
            const later = addDays(today, 40)
            await Policy.saveVersion("c1", { effectiveFrom: later, body: SIX_DAY_FACTORY }, "a1")
            await Policy.saveVersion("c1", { effectiveFrom: later, body: { ...SIX_DAY_FACTORY, absence: { multiplier: 1.5 } } }, "a1")
            const versions = await Policy.versions("c1")
            expect(versions.map(v => [v.effectiveFrom, v.body.absence.multiplier])).toEqual([[today, 1], [later, 1.5]])
            await expect(Policy.saveVersion("c1", { effectiveFrom: today, body: SIX_DAY_FACTORY }, "a1")).rejects.toEqual(refusal("VERSION_DATE_TAKEN"))
        })

        it("refuses a version inside an approved month, and a malformed body", async () => {
            await expect(Policy.saveVersion("c1", { effectiveFrom: "2026-09-15", body: STANDARD_OFFICE }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await expect(Policy.saveVersion("c1", { effectiveFrom: "2027-01-01", body: { workWeek: [0] } }, "a1")).rejects.toEqual(refusal("POLICY_INVALID"))
            const gap = structuredClone(STANDARD_OFFICE)
            gap.lateness.bands[1].fromMinutes = 35
            await expect(Policy.saveVersion("c1", { effectiveFrom: "2027-01-01", body: gap }, "a1")).rejects.toEqual(refusal("BANDS_NOT_CONTIGUOUS"))
        })

        it("withdraws a version, leaving the one before in force", async () => {
            const versions = await Policy.versions("c1")
            await Policy.deleteVersion(versions[1].id, "a1")
            expect((await Policy.versions("c1")).length).toBe(1)
        })

        it("refuses a version that starts in an open month but governs an approved one", async () => {
            // September is approved and the next version starts on 1 October:
            // a version from 1 August would be the one in force all September.
            await expect(Policy.saveVersion("c1", { effectiveFrom: "2026-08-01", body: SIX_DAY_FACTORY }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            // Withdrawing one hands its span to the version before, so the same holds.
            await db.query(`INSERT INTO "AttendancePolicy" (id, "companyId", "effectiveFrom", body, "createdById") VALUES ('aug-policy', 'c1', '2026-08-01', $1, 'a1')`, [JSON.stringify(STANDARD_OFFICE)])
            await expect(Policy.deleteVersion("aug-policy", "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await db.query(`DELETE FROM "AttendancePolicy" WHERE id = 'aug-policy'`)
        })
    })

    it("writes every change to the audit log, as the person who made it", async () => {
        const { rows } = await db.query(`SELECT action, "entityType", "userId", "superAdminId" FROM "AuditLog" WHERE "entityType" IN ('ATTENDANCE_CALENDAR', 'PUBLIC_HOLIDAY')`)
        const actions = new Set(rows.map(r => r.action))
        for (const a of ["CREATE_WORK_SCHEDULE", "SET_DEFAULT_SCHEDULE", "WITHDRAW_DEFAULT_SCHEDULE", "CREATE_SCHEDULE_VERSION", "DELETE_SCHEDULE_VERSION", "CREATE_SCHEDULE_OVERRIDE",
            "UPDATE_SCHEDULE_OVERRIDE", "ASSIGN_WORK_SCHEDULE", "UNASSIGN_WORK_SCHEDULE", "ARCHIVE_WORK_SCHEDULE", "SKIP_PUBLIC_HOLIDAY",
            "OBSERVE_PUBLIC_HOLIDAY", "CREATE_COMPANY_HOLIDAY", "UPDATE_PUBLIC_HOLIDAY"]) {
            expect(actions, a).toContain(a)
        }
        expect(rows.filter(r => r.entityType === "ATTENDANCE_CALENDAR").every(r => r.userId === "a1" && r.superAdminId === null)).toBe(true)
    })
})
