import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { calendarDateStr } from "@/lib/time"
import { addDays } from "@/lib/attendance/calendar"
import { startOfDate } from "@/lib/contract-start"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The contract start date (LATER_CHANGES_PLAN.md §7.2, step 1, PR 425),
 * against a real Postgres: the migration gives each company's Admin role the
 * permission to change it, and changing it moves their hiring and their
 * starting salary, logged, or is refused where it would reach a month whose
 * payroll is approved, or pass something else recorded about their job.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const ZONE = "Africa/Cairo"
const today = calendarDateStr(new Date(), ZONE)
const day = (n: number) => addDays(today, n)
const at = (date: string) => startOfDate(date, ZONE).toISOString()

// Made-up people, each hired ten days ago with a salary dated the same.
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Made Up', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1'),
 ('e4', 'e4@x', 'p', 'Eid', 'One', 'EMPLOYEE', 2026, 'e4', 'c1');
`
const RECORDS = `
INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
 ('h1', 'e1', 'HIRED', '${at(day(-10))}'), ('h2', 'e2', 'HIRED', '${at(day(-10))}'),
 ('h3', 'e3', 'HIRED', '${at(day(-10))}'), ('h4', 'e4', 'HIRED', '${at(day(-10))}');
INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
 ('s1', 'e1', 9300, '${at(day(-10))}'), ('s2', 'e2', 9300, '${at(day(-10))}'),
 ('s3', 'e3', 9300, '${at(day(-10))}'), ('s4', 'e4', 9300, '${at(day(-10))}'),
 ('s3r', 'e3', 9900, '${at(day(-5))}');
`

const by = { userId: "a1", superAdminId: null }

describe.skipIf(!ADMIN_URL)("the contract start date, in Postgres", () => {
    const dbName = `contract_start_test_${Date.now()}`
    let db: Client
    let Starts: typeof import("@/lib/services/contract-start.service").ContractStartService
    let prisma: typeof import("@/lib/prisma").prisma
    let versionsBefore: { id: string; builtIn: string | null; version: number }[] = []

    const startOf = async (userId: string) => (await db.query(`SELECT "effectiveFrom" AS at FROM "EmploymentEvent" WHERE "userId" = $1 AND type = 'HIRED'`, [userId])).rows[0].at.toISOString()
    const salariesOf = async (userId: string) => (await db.query(`SELECT id, "effectiveFrom" AS at FROM "SalaryChange" WHERE "userId" = $1 ORDER BY id`, [userId])).rows.map(r => [r.id, r.at.toISOString()])
    const refusal = (p: Promise<unknown>) => p.then(() => "changed", (e: Error) => e.message)

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            // The roles' versions before the migration that gives the Admin's the permission.
            if (m === "20270122000000_contract_start_permission") versionsBefore = (await db.query(`SELECT id, "builtIn", version FROM "Role" ORDER BY id`)).rows
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(RECORDS)
        await db.query(`UPDATE "Company" SET timezone = '${ZONE}'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Starts = (await import("@/lib/services/contract-start.service")).ContractStartService
        prisma = (await import("@/lib/prisma")).prisma
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("gives each company's Admin role the permission, and has its holders reload", async () => {
        const admins = versionsBefore.filter(r => r.builtIn === "ADMIN")
        expect(admins.length).toBe(1)
        const grants = (await db.query(`SELECT "roleId", scope FROM "RoleGrant" WHERE permission = 'employees.edit_contract_start' ORDER BY "roleId"`)).rows
        expect(grants).toEqual(admins.map(r => ({ roleId: r.id, scope: "COMPANY" })))
        const versions = (await db.query(`SELECT id, version FROM "Role" ORDER BY id`)).rows
        expect(versions).toEqual(versionsBefore.map(r => ({ id: r.id, version: r.builtIn === "ADMIN" ? r.version + 1 : r.version })))
    })

    it("reads when someone's contract started, in the company's calendar", async () => {
        expect((await Starts.of("e1"))?.date).toBe(day(-10))
        expect(await Starts.of("nobody")).toBeNull()
    })

    it("moves their hiring and starting salary to an earlier date, and logs it", async () => {
        expect(await Starts.change("e1", day(-40), by)).toEqual({ from: day(-10), to: day(-40) })
        expect(await startOf("e1")).toBe(at(day(-40)))
        expect(await salariesOf("e1")).toEqual([["s1", at(day(-40))]])
        const log = (await db.query(`SELECT action, "entityId", details, "userId" FROM "AuditLog" WHERE action = 'CONTRACT_START_CHANGED'`)).rows
        expect(log).toEqual([{ action: "CONTRACT_START_CHANGED", entityId: "e1", details: { from: day(-10), to: day(-40), salaryMoved: true }, userId: "a1" }])
    })

    it("moves them to a later date, a future one too", async () => {
        await Starts.change("e2", day(20), by)
        expect(await startOf("e2")).toBe(at(day(20)))
        expect(await salariesOf("e2")).toEqual([["s2", at(day(20))]])
    })

    it("refuses a date after their salary changed, and moves it before", async () => {
        expect(await refusal(Starts.change("e3", day(-2), by))).toBe("CONTRACT_START_AFTER_CHANGE")
        expect(await startOf("e3")).toBe(at(day(-10)))
        await Starts.change("e3", day(-7), by)
        expect(await salariesOf("e3")).toEqual([["s3", at(day(-7))], ["s3r", at(day(-5))]])
    })

    it("refuses a date more than a year away, or not a date, or the one it is", async () => {
        expect(await refusal(Starts.change("e4", addDays(today, -400), by))).toBe("CONTRACT_START_OUT_OF_RANGE")
        expect(await refusal(Starts.change("e4", addDays(today, 400), by))).toBe("CONTRACT_START_OUT_OF_RANGE")
        expect(await refusal(Starts.change("e4", "soon", by))).toBe("CONTRACT_START_OUT_OF_RANGE")
        expect(await refusal(Starts.change("e4", day(-10), by))).toBe("CONTRACT_START_SAME")
        expect(await startOf("e4")).toBe(at(day(-10)))
    })

    it("refuses a date reaching a month whose payroll is approved", async () => {
        const locked = day(-70).slice(0, 7)
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run', 'c1', $1, $2, 'APPROVED', 25, now())`, [Number(locked.slice(5, 7)), Number(locked.slice(0, 4))])
        try {
            expect(await refusal(Starts.change("e4", day(-75), by))).toBe("PAYROLL_MONTH_LOCKED")
            expect(await startOf("e4")).toBe(at(day(-10)))
            expect(await salariesOf("e4")).toEqual([["s4", at(day(-10))]])
        } finally {
            await db.query(`DELETE FROM "PayrollRun" WHERE id = 'run'`)
        }
    })

    describe("someone new", () => {
        const session = { user: { ...withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }), name: "Amal One", mfaEnabled: true, stepUpAt: Date.now() } } as never
        const person = (n: number, contractStart?: string) => ({
            firstName: `New${n}`, lastName: "Person", firstNameAr: "جديد", lastNameAr: "شخص", email: `new${n}@x.example`, password: "a-long-password",
            role: "EMPLOYEE" as const, gender: "MALE" as const, salary: 0, ...(contractStart ? { contractStart } : {}),
        })
        const hiringOf = async (email: string) => (await db.query(`SELECT e."effectiveFrom" AS at FROM "EmploymentEvent" e JOIN "User" u ON u.id = e."userId" WHERE u.email = $1 AND e.type = 'HIRED'`, [email])).rows.map(r => r.at.toISOString())
        const salaryOf = async (email: string) => (await db.query(`SELECT s."effectiveFrom" AS at FROM "SalaryChange" s JOIN "User" u ON u.id = s."userId" WHERE u.email = $1`, [email])).rows.map(r => r.at.toISOString())

        it("starts their contract on the day given, their hiring and starting salary with it", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            await UserService.create(person(1, day(-15)) as never, session)
            expect(await hiringOf("new1@x.example")).toEqual([at(day(-15))])
            expect(await salaryOf("new1@x.example")).toEqual([at(day(-15))])
        })

        it("starts it today, at the start of the day, when none is given", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            await UserService.create(person(2) as never, session)
            expect(await hiringOf("new2@x.example")).toEqual([at(today)])
        })

        it("refuses a date more than a year away, and one in a month whose payroll is approved", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            expect(await refusal(UserService.create(person(3, addDays(today, -400)) as never, session))).toBe("CONTRACT_START_OUT_OF_RANGE")
            const locked = day(-70).slice(0, 7)
            await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run2', 'c1', $1, $2, 'APPROVED', 25, now())`, [Number(locked.slice(5, 7)), Number(locked.slice(0, 4))])
            try {
                expect(await refusal(UserService.create(person(4, day(-70)) as never, session))).toBe("PAYROLL_MONTH_LOCKED")
            } finally {
                await db.query(`DELETE FROM "PayrollRun" WHERE id = 'run2'`)
            }
            expect(await hiringOf("new3@x.example")).toEqual([])
            expect(await hiringOf("new4@x.example")).toEqual([])
        })

        it("refuses a start in an open month where a later one's payroll is approved, as they'd be paid in it too (review on PR 425)", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            const later = day(-40).slice(0, 7)
            await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run3', 'c1', $1, $2, 'APPROVED', 25, now())`, [Number(later.slice(5, 7)), Number(later.slice(0, 4))])
            try {
                expect(await refusal(UserService.create(person(5, day(-75)) as never, session))).toBe("PAYROLL_MONTH_LOCKED")
            } finally {
                await db.query(`DELETE FROM "PayrollRun" WHERE id = 'run3'`)
            }
            expect(await hiringOf("new5@x.example")).toEqual([])
        })
    })

    it("refuses someone with no hiring on record, such as a company's Admin made before hirings were", async () => {
        expect(await refusal(Starts.change("a1", day(-40), by))).toBe("NO_CONTRACT_START")
    })

    // Last: it ages what the others made.
    it("has the nightly run rebuild from the earlier of a moved start's two dates, as the rows it moves keep when they were made (review on PR 425)", async () => {
        const { AttendanceEngineService, monthsBetween } = await import("@/lib/services/attendance-engine.service")
        const age = async () => {
            await db.query(`UPDATE "EmploymentEvent" SET "createdAt" = now() - interval '30 days'`)
            await db.query(`UPDATE "SalaryChange" SET "createdAt" = now() - interval '30 days'`)
            await db.query(`UPDATE "AuditLog" SET "createdAt" = now() - interval '30 days' WHERE action = 'CONTRACT_START_CHANGED'`)
        }
        const rebuilt = async () => {
            const run = await AttendanceEngineService.reconcileAll(["c1"])
            return run.months + run.failed.length
        }
        // A move the last run had already, long before.
        await db.query(`INSERT INTO "AuditLog"(id, action, "entityType", "entityId", details) VALUES ('long-ago', 'CONTRACT_START_CHANGED', 'USER', 'e4', $1)`, [JSON.stringify({ from: day(-200), to: day(-190), salaryMoved: true })])
        await age()
        await db.query(`INSERT INTO "JobHeartbeat"(job, "lastRunAt", "lastSuccessAt", "updatedAt") VALUES ('attendance', now(), now(), now())`)
        // Nothing new: this month and last.
        expect(await rebuilt()).toBe(2)
        // Earlier: from the new date.
        await Starts.change("e4", day(-100), by)
        expect(await rebuilt()).toBe(monthsBetween(day(-100), today).length)
        // Its own company's: another's, this month and last.
        await db.query(`INSERT INTO "Company"(id, name, "updatedAt", timezone) VALUES ('c2', 'Made Up Too', now(), '${ZONE}')`)
        const other = await AttendanceEngineService.reconcileAll(["c2"])
        expect(other.months + other.failed.length).toBe(2)
        // Later: from the old one.
        await age()
        await Starts.change("e4", day(-60), by)
        expect(await rebuilt()).toBe(monthsBetween(day(-100), today).length)
    })
})
