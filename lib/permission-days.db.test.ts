import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * The days permission hours' calendar offers are the days they may be asked
 * for (LATER_CHANGES_PLAN.md §7.20; DESIGN.md §5.5, Asking for permission
 * hours), against a real Postgres built from the migrations, with made-up
 * companies:
 * - One, around the day with 24 hours after; Two, with none;
 * - Three, around the day with a night shift, 22:00 to 06:00;
 * - Four, around the day with October approved;
 * - Five, any day, its first policy from 15 November;
 * - Six, around the day with 24 hours after, its first policy from today.
 * The clock is 10:00 on Friday 27 November 2026 in Cairo, unless a test
 * moves it.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now()), ('c3', 'Three', now()), ('c4', 'Four', now()), ('c5', 'Five', now()), ('c6', 'Six', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2'),
 ('e3', 'e3@x', 'p', 'Essam', 'Three', 'EMPLOYEE', 2026, 'e3', 'c3'),
 ('e4', 'e4@x', 'p', 'Enas', 'Four', 'EMPLOYEE', 2026, 'e4', 'c4'),
 ('e5', 'e5@x', 'p', 'Ezz', 'Five', 'EMPLOYEE', 2026, 'e5', 'c5'),
 ('e6', 'e6@x', 'p', 'Eslam', 'Six', 'EMPLOYEE', 2026, 'e6', 'c6');
`

const NOW = new Date("2026-11-27T08:00:00Z")
const ask = (date: string, start = "12:00", end = "12:30") => ({ date, type: "MIDDAY" as const, start, end, reason: "Errand" })

describe.skipIf(!ADMIN_URL)("the days permission hours' calendar offers, in Postgres", () => {
    const dbName = `permission_days_test_${Date.now()}`
    let db: Client
    let Requests: typeof import("@/lib/services/attendance-request.service")
    const policy = (id: string, companyId: string, from: string, body: object) =>
        db.query(`INSERT INTO "AttendancePolicy"(id, "companyId", "effectiveFrom", body, "createdById") VALUES ($1, $2, $3, $4, 'e1')`, [id, companyId, from, JSON.stringify(body)])
    const around = (hours: number) => {
        // Saved before the choice existed, as the live company's was: around the day.
        const before: Record<string, unknown> = { ...STANDARD_OFFICE.permissionHours, afterTheFactHours: hours }
        delete before.when
        return { ...STANDARD_OFFICE, permissionHours: before }
    }

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
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Requests = await import("@/lib/services/attendance-request.service")

        await policy("p1", "c1", "2026-10-01", around(24))
        await policy("p2", "c2", "2026-10-01", around(0))
        await policy("p3", "c3", "2026-01-01", around(24))
        await policy("p4", "c4", "2026-09-01", around(24))
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "periodStart", "periodEnd", "updatedAt") VALUES
            ('r10', 'c4', 10, 2026, 'APPROVED', 1, '2026-10-01', '2026-10-31', now())`)
        await policy("p6", "c6", "2026-11-27", around(24))
        await policy("p5", "c5", "2026-11-15", { ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, when: "ANY_DAY" } })
        const { AttendanceCalendarService } = await import("@/lib/services/attendance-calendar.service")
        await AttendanceCalendarService.createSchedule("c3", { name: "Night", version: { effectiveFrom: "2026-01-01", startMinutes: 1320, endMinutes: 1800, breakMinutes: 0 } }, "e3")
    }, 180_000)

    afterEach(() => { vi.setSystemTime(NOW) })

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    it("around the day, start on the day the hours after reach back to", async () => {
        const { AttendanceRequestService } = Requests
        // 10:00 less 24 hours is 10:00 yesterday.
        expect(await AttendanceRequestService.permissionEarliest("c1", "e1")).toBe("2026-11-26")
        // With none, only ahead: from today.
        expect(await AttendanceRequestService.permissionEarliest("c2", "e2")).toBe("2026-11-27")
    })

    it("around the day, refuse the day before them, as too late", async () => {
        const { AttendanceRequestService } = Requests
        await expect(AttendanceRequestService.requestPermission("c1", "e1", ask("2026-11-25", "16:00", "17:00"))).rejects.toMatchObject({ message: "PERMISSION_TOO_LATE" })
        // Their first day, its hours within the 24: taken.
        await AttendanceRequestService.requestPermission("c1", "e1", ask("2026-11-26", "16:00", "17:00"))
    })

    it("around the day, take in the day before where its night shift ends late enough", async () => {
        const { AttendanceRequestService } = Requests
        // 05:00: the night from the 25th ended at 06:00 on the 26th, under 24 hours ago.
        vi.setSystemTime(new Date("2026-11-27T03:00:00Z"))
        expect(await AttendanceRequestService.permissionEarliest("c3", "e3")).toBe("2026-11-25")
        // And the server takes its morning, as the calendar offers it.
        await AttendanceRequestService.requestPermission("c3", "e3", ask("2026-11-25", "05:00", "06:00"))
        // At 10:00 that night ended more than 24 hours ago.
        vi.setSystemTime(NOW)
        expect(await AttendanceRequestService.permissionEarliest("c3", "e3")).toBe("2026-11-26")
    })

    it("around the day, never start in a month whose payroll is approved", async () => {
        const { AttendanceRequestService } = Requests
        vi.setSystemTime(new Date("2026-11-01T08:00:00Z"))
        expect(await AttendanceRequestService.permissionEarliest("c4", "e4")).toBe("2026-11-01")
    })

    it("around the day, never start before the company's first policy", async () => {
        const { AttendanceRequestService } = Requests
        expect(await AttendanceRequestService.permissionEarliest("c6", "e6")).toBe("2026-11-27")
    })

    it("any day, start no earlier than the company's first policy, and are none around the day", async () => {
        const { AttendanceRequestService, PermissionOutOfRange } = Requests
        expect(await AttendanceRequestService.permissionDays("c5")).toEqual({ from: "2026-11-15", to: "2026-12-27" })
        const before = AttendanceRequestService.requestPermission("c5", "e5", ask("2026-11-10"))
        await expect(before).rejects.toBeInstanceOf(PermissionOutOfRange)
        await expect(before).rejects.toMatchObject({ from: "2026-11-15", to: "2026-12-27" })
        // Any day has its days; around the day, its first one.
        expect(await AttendanceRequestService.permissionEarliest("c5", "e5")).toBeNull()
        expect(await AttendanceRequestService.permissionDays("c1")).toBeNull()
    })
})
