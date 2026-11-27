import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"

/**
 * When permission hours may be asked for, against a real Postgres built from
 * the migrations (LATER_CHANGES_PLAN.md §7.4, 4b).
 *
 * The clock is held at 10:00 on Friday 27 November 2026 in Cairo. One's policy
 * says any day, with September paid and October approved; Two's was saved
 * before the choice existed, so around the day, with 24 hours after.
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
const ask = (date: string, start = "12:00", end = "12:30") => ({ date, type: "MIDDAY" as const, start, end, reason: "Errand" })

describe.skipIf(!ADMIN_URL)("when permission hours may be asked for, in Postgres", () => {
    const dbName = `permission_when_test_${Date.now()}`
    let db: Client
    let url: URL
    let Requests: typeof import("@/lib/services/attendance-request.service")
    const policy = (id: string, companyId: string, from: string, body: object) =>
        db.query(`INSERT INTO "AttendancePolicy"(id, "companyId", "effectiveFrom", body, "createdById") VALUES ($1, $2, $3, $4, 'e1')`, [id, companyId, from, JSON.stringify(body)])
    const asked = async (userId: string) => (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM "PermissionRequest" WHERE "userId" = $1 ORDER BY date`, [userId])).rows.map(r => r.d)

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
        Requests = await import("@/lib/services/attendance-request.service")

        const anyDay = { ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, when: "ANY_DAY" } }
        await policy("p1", "c1", "2026-10-01", anyDay)
        // From 1 December, around the day again: not yet in force.
        await policy("p1b", "c1", "2026-12-01", STANDARD_OFFICE)
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "periodStart", "periodEnd", "updatedAt") VALUES
            ('r9', 'c1', 9, 2026, 'PAID', 1, '2026-09-01', '2026-09-30', now()),
            ('r10', 'c1', 10, 2026, 'APPROVED', 1, '2026-10-01', '2026-10-31', now()),
            ('r11', 'c1', 11, 2026, 'DRAFT', 1, NULL, NULL, now())`)
        // Saved before the choice existed: around the day.
        const before: Record<string, unknown> = { ...STANDARD_OFFICE.permissionHours }
        delete before.when
        await policy("p2", "c2", "2026-10-01", { ...STANDARD_OFFICE, permissionHours: before })
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

    it("are, any day, from the day after the approved month's period to today plus one month, by the policy in force today", async () => {
        const { AttendanceRequestService } = Requests
        expect(await AttendanceRequestService.permissionDays("c1")).toEqual({ from: "2026-11-01", to: "2026-12-27" })
        // Around the day, there are no such days: as before.
        expect(await AttendanceRequestService.permissionDays("c2")).toBeNull()
    })

    it("any day: refuses a day outside them, saying which, and takes one inside, a day passed too, whatever its hours", async () => {
        const { AttendanceRequestService, PermissionOutOfRange } = Requests
        // October is approved: refused with the days, not as a month paid.
        const before = AttendanceRequestService.requestPermission("c1", "e1", ask("2026-10-31"))
        await expect(before).rejects.toBeInstanceOf(PermissionOutOfRange)
        await expect(before).rejects.toMatchObject({ message: "PERMISSION_OUT_OF_RANGE", from: "2026-11-01", to: "2026-12-27" })
        await expect(AttendanceRequestService.requestPermission("c1", "e1", ask("2026-12-28"))).rejects.toMatchObject({ message: "PERMISSION_OUT_OF_RANGE" })
        // Three weeks ago, its hours long over: taken.
        await AttendanceRequestService.requestPermission("c1", "e1", ask("2026-11-02", "09:00", "10:00"))
        await AttendanceRequestService.requestPermission("c1", "e1", ask("2026-12-27"))
        expect(await asked("e1")).toEqual(["2026-11-02", "2026-12-27"])
    })

    it("around the day: refuses hours too long past, and takes a day however far ahead, as before", async () => {
        const { AttendanceRequestService } = Requests
        await expect(AttendanceRequestService.requestPermission("c2", "e2", ask("2026-11-02", "09:00", "10:00"))).rejects.toMatchObject({ message: "PERMISSION_TOO_LATE" })
        await AttendanceRequestService.requestPermission("c2", "e2", ask("2027-03-01"))
        expect(await asked("e2")).toEqual(["2027-03-01"])
    })

    it("reads them holding the locks of the months the day falls in, so approving one meanwhile waits", async () => {
        const { AttendanceRequestService } = Requests
        const other = new Client({ connectionString: url.toString() })
        await other.connect()
        const held: boolean[] = []
        const days = AttendanceRequestService.permissionDays.bind(AttendanceRequestService)
        const spy = vi.spyOn(AttendanceRequestService, "permissionDays").mockImplementation(async (...args) => {
            // The look under the locks, given the transaction.
            if (args[1]) for (const month of ["2026-11", "2026-12"]) {
                const { rows } = await other.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS got`, [`attendance-month:c1:${month}`])
                held.push(!rows[0].got)
                if (rows[0].got) await other.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`attendance-month:c1:${month}`])
            }
            return days(...args)
        })
        try {
            await AttendanceRequestService.requestPermission("c1", "e1", ask("2026-11-30"))
            expect(held).toEqual([true, true])
        } finally {
            spy.mockRestore()
            await other.end()
        }
    })
})
