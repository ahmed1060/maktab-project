import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { CheckInReminderService as Reminders } from "@/lib/services/check-in-reminder.service"
import { AttendanceCalendarService as Calendar } from "@/lib/services/attendance-calendar.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * "You haven't checked in" (lib/services/check-in-reminder.service.ts,
 * ATTENDANCE_PLAN.md §13.4), against a real Postgres built from the
 * migrations: who is reminded, when, and only once.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Essam', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e4', 'e4@x', 'p', 'Eslam', 'Four', 'EMPLOYEE', 2026, 'e4', 'c1', NULL),
 ('e5', 'e5@x', 'p', 'Eyad', 'Five', 'EMPLOYEE', 2026, 'e5', 'c1', NULL);
`

describe.skipIf(!ADMIN_URL)("the no-check-in reminder, in Postgres", () => {
    const dbName = `reminder_test_${Date.now()}`
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
        await db.query(`UPDATE "Company" SET timezone = 'Africa/Cairo'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        delete process.env.FCM_SERVICE_ACCOUNT
        delete process.env.APNS_KEY
        // 09:00–17:00 Sunday to Thursday for everyone; e5 on 22:00–06:00 nights. Reminded 15 minutes in.
        const office = await Calendar.createSchedule("c1", { name: "Office", version: { effectiveFrom: "2026-01-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }, "a1")
        await Calendar.setDefault(office.id, "2026-01-01", "a1")
        const night = await Calendar.createSchedule("c1", { name: "Night", version: { effectiveFrom: "2026-01-01", startMinutes: 1320, endMinutes: 1800, breakMinutes: 0 } }, "a1")
        await Calendar.assign("c1", { userIds: ["e5"], scheduleId: night.id, effectiveFrom: "2026-01-01" }, "a1")
        await Policy.saveVersion("c1", { effectiveFrom: "2026-01-01", body: STANDARD_OFFICE }, "a1")
        // Phones: e1, e2, e4, e5 check in with the app; e3 doesn't.
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status) VALUES
            ('p1', 'c1', 'e1', 'k', 'f1', 'ANDROID', 'ACTIVE'), ('p2', 'c1', 'e2', 'k', 'f2', 'ANDROID', 'ACTIVE'),
            ('p4', 'c1', 'e4', 'k', 'f4', 'IOS', 'PENDING'), ('p5', 'c1', 'e5', 'k', 'f5', 'ANDROID', 'ACTIVE')`)
        // Eman checked in at 08:55 on Sunday 27th; Eslam is on leave that day.
        await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status) VALUES ('in', 'c1', 'e2', 'MOBILE', 'in', '2026-09-27 08:55', '2026-09-27 05:55', 'Africa/Cairo', 'FLAGGED')`)
        await db.query(`INSERT INTO "DayOffRequest"(id, "userId", type, date, status, "updatedAt") VALUES ('leave', 'e4', 'REGULAR', '2026-09-27', 'APPROVED', now())`)
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const reminders = async () => (await db.query(`SELECT "userId", to_char(date, 'YYYY-MM-DD') AS date FROM "CheckInReminder" ORDER BY date, "userId"`)).rows
    const notices = async (userId: string) => (await db.query(`SELECT type, "messageKey", "messageParams", "relatedId" FROM "Notification" WHERE "userId" = $1`, [userId])).rows

    it("waits until the policy's minutes have passed", async () => {
        // Sunday 27th, 09:10 in Cairo (UTC+3): ten minutes in.
        expect(await Reminders.run(new Date("2026-09-27T06:10:00Z"))).toMatchObject({ reminded: 0 })
    })

    it("then reminds whoever checks in with the app and hasn't, once, with a link to check in", async () => {
        // 09:20: Ehab hasn't checked in; Eman has; Essam has no app; Eslam is on leave.
        const first = await Reminders.run(new Date("2026-09-27T06:20:00Z"))
        expect(first).toMatchObject({ reminded: 1, pushed: { skipped: "NOT_CONFIGURED" } })
        expect(await reminders()).toEqual([{ userId: "e1", date: "2026-09-27" }])
        expect(await notices("e1")).toEqual([{ type: "ATTENDANCE_REMINDER", messageKey: "notice_att_checkin_reminder", messageParams: { time: "09:00" }, relatedId: "/dashboard/check-in" }])
        // The next run, five minutes on: nothing more.
        expect(await Reminders.run(new Date("2026-09-27T06:25:00Z"))).toMatchObject({ reminded: 0 })
        expect(await notices("e1")).toHaveLength(1)
    })

    it("reminds nobody who can't sign in: suspended, or whose contract ended", async () => {
        // Monday 28th, 09:20: Ehab is due again, but is suspended; then archived.
        const ehab = async () => (await reminders()).filter(r => r.userId === "e1" && r.date === "2026-09-28")
        await db.query(`UPDATE "User" SET status = 'SUSPENDED' WHERE id = 'e1'`)
        await Reminders.run(new Date("2026-09-28T06:20:00Z"))
        expect(await ehab()).toEqual([])
        await db.query(`UPDATE "User" SET status = 'ARCHIVED' WHERE id = 'e1'`)
        await Reminders.run(new Date("2026-09-28T06:21:00Z"))
        expect(await ehab()).toEqual([])
        await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id = 'e1'`)
        await db.query(`DELETE FROM "CheckInReminder" WHERE date = '2026-09-28'`)
    })

    it("counts only this company's check-ins: one kept from a company the person left doesn't", async () => {
        // Tuesday 29th: Ehab's punch at 08:55 belongs to a company he worked for before.
        await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('old', 'Before', now())`)
        await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES ('elsewhere', 'old', 'e1', 'MANUAL', 'elsewhere', '2026-09-29 08:55', '2026-09-29 05:55', 'Africa/Cairo')`)
        await Reminders.run(new Date("2026-09-29T06:20:00Z"))
        expect((await reminders()).filter(r => r.userId === "e1" && r.date === "2026-09-29")).toHaveLength(1)
    })

    it("reminds a night shift after its start, and nobody long after it was due", async () => {
        // 22:20 on Sunday 27th: Eyad's night started at 22:00.
        expect(await Reminders.run(new Date("2026-09-27T19:20:00Z"))).toMatchObject({ reminded: 1 })
        expect((await reminders()).map(r => r.userId)).toContain("e5")
        // Monday 28th at 11:30, two and a half hours in: too late to be useful.
        expect(await Reminders.run(new Date("2026-09-28T08:30:00Z"))).toMatchObject({ reminded: 0 })
    })

    it("says nothing on a rest day", async () => {
        // Friday 2nd October, 09:20.
        expect(await Reminders.run(new Date("2026-10-02T06:20:00Z"))).toMatchObject({ reminded: 0 })
    })
})
