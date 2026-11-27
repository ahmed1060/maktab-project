import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { builtInGrantsToken } from "@/lib/permissions/built-in"
import { serializeAccess } from "@/lib/features/bundles"
import { UserService } from "@/lib/services/user.service"

/**
 * A salary change's payroll (LATER_CHANGES_PLAN.md §7.13; DESIGN.md, A
 * salary change's payroll): saved from an employee's Edit with which payroll
 * it's for, this month's from its 1st or next month's from its 1st, in the
 * company's calendar. With this month's payroll approved, this month's is
 * refused before anything is saved. Against a real Postgres built from the
 * migrations, with made-up people.
 */

// A new pay figure asks for a code (ROLES_PLAN.md §6.15), which has its own tests.
vi.mock("@/lib/step-up", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/step-up")>()), assertStepUp: async () => {} }))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

// Before the roles, so each company gets its built-in ones as it would.
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Cairo One', now()), ('c2', 'New York Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", salary, "dayOffCredit", "baseDayOffCredit") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', 0, 0, 0),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 5000, 21, 21),
 ('a2', 'a2@x', 'p', 'Basma', 'Two', 'ADMIN', 2026, 'a2', 'c2', 0, 0, 0),
 ('e2', 'e2@x', 'p', 'Fady', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2', 4000, 21, 21);
`
const AFTER_ALL = `
UPDATE "Company" SET timezone = 'America/New_York' WHERE id = 'c2';
INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom", reason, "createdAt") VALUES
 ('s1', 'e1', 5000, '2026-01-01T00:00:00Z', 'Starting salary', '2026-01-01T00:00:00Z'),
 ('s2', 'e2', 4000, '2026-01-01T00:00:00Z', 'Starting salary', '2026-01-01T00:00:00Z');
`

/** The company's Admin, with pay in its package. */
const admin = (id: string, companyId: string) => ({
    user: { id, role: "ADMIN", companyId, grants: builtInGrantsToken("ADMIN"), featureAccess: serializeAccess({ unrestricted: false, bundles: new Set(["COMPANY_MANAGEMENT", "HR"] as const) }) },
})

describe.skipIf(!ADMIN_URL)("a salary change's payroll, in Postgres", () => {
    const dbName = `salary_payroll_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
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
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        await db.query(AFTER_ALL)
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        await root.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await root.end()
    })

    // Only the clock: the database's own timers stay real.
    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }) })
    afterEach(async () => {
        vi.useRealTimers()
        // Each starts from their starting salary, with no payroll.
        await db.query(`DELETE FROM "SalaryChange" WHERE id NOT IN ('s1', 's2')`)
        await db.query(`DELETE FROM "PayrollRun"`)
        await db.query(`UPDATE "User" SET salary = 5000, gender = 'MALE' WHERE id = 'e1'`)
        await db.query(`UPDATE "User" SET salary = 4000 WHERE id = 'e2'`)
    })

    /** Their salaries since the starting one, as entered: the amount and the day it's from, in UTC. */
    const changes = async (userId: string) => (await db.query(
        `SELECT "monthlyAmount", "effectiveFrom" FROM "SalaryChange" WHERE "userId" = $1 AND reason IS DISTINCT FROM 'Starting salary' ORDER BY "createdAt"`, [userId],
    )).rows.map(r => [Number(r.monthlyAmount), (r.effectiveFrom as Date).toISOString()])
    const salary = async (userId: string) => Number((await db.query(`SELECT salary FROM "User" WHERE id = $1`, [userId])).rows[0].salary)
    const gender = async (userId: string) => (await db.query(`SELECT gender FROM "User" WHERE id = $1`, [userId])).rows[0].gender as string
    const approve = (companyId: string, year: number, month: number, status = "APPROVED") => db.query(
        `INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4::"PayrollRunStatus", 1, now())`,
        [companyId, year, month, status],
    )

    it("dates this month's payroll from its 1st", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await UserService.update({ id: "e1", salary: 6000, salaryEffective: "THIS_MONTH" } as any, admin("a1", "c1"))
        // 1 November in Cairo.
        expect(await changes("e1")).toEqual([[6000, "2026-10-31T22:00:00.000Z"]])
        expect(await salary("e1")).toBe(6000)
    })

    it("dates next month's payroll from its 1st, and shows it as their salary, the one set last", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await UserService.update({ id: "e1", salary: 6500, salaryEffective: "NEXT_MONTH" } as any, admin("a1", "c1"))
        expect(await changes("e1")).toEqual([[6500, "2026-11-30T22:00:00.000Z"]])
        expect(await salary("e1")).toBe(6500)
    })

    it("refuses this month's payroll once it's approved, saving nothing", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await approve("c1", 2026, 11)
        await expect(UserService.update({ id: "e1", gender: "FEMALE", salary: 6000, salaryEffective: "THIS_MONTH" } as any, admin("a1", "c1")))
            .rejects.toThrow("PAYROLL_MONTH_LOCKED")
        expect(await changes("e1")).toEqual([])
        expect(await salary("e1")).toBe(5000)
        expect(await gender("e1")).toBe("MALE")
    })

    it("refuses it once it's paid too", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await approve("c1", 2026, 11, "PAID")
        await expect(UserService.update({ id: "e1", salary: 6000, salaryEffective: "THIS_MONTH" } as any, admin("a1", "c1"))).rejects.toThrow("PAYROLL_MONTH_LOCKED")
    })

    it("takes this month's payroll as asked for where the choice isn't sent, and refuses it the same", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await approve("c1", 2026, 11)
        await expect(UserService.update({ id: "e1", salary: 6000 } as any, admin("a1", "c1"))).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        expect(await changes("e1")).toEqual([])
    })

    it("dates it from this month's 1st where the choice isn't sent, as it always was", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await UserService.update({ id: "e1", salary: 6000 } as any, admin("a1", "c1"))
        expect(await changes("e1")).toEqual([[6000, "2026-10-31T22:00:00.000Z"]])
    })

    it("still takes next month's payroll with this month's approved", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await approve("c1", 2026, 11)
        await UserService.update({ id: "e1", salary: 6500, salaryEffective: "NEXT_MONTH" } as any, admin("a1", "c1"))
        expect(await changes("e1")).toEqual([[6500, "2026-11-30T22:00:00.000Z"]])
    })

    it("isn't refused for a save that leaves the salary as it is", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await approve("c1", 2026, 11)
        await UserService.update({ id: "e1", gender: "FEMALE", salary: 5000, salaryEffective: "THIS_MONTH" } as any, admin("a1", "c1"))
        expect(await gender("e1")).toBe("FEMALE")
        expect(await changes("e1")).toEqual([])
    })

    it("isn't refused by another month's approved payroll", async () => {
        vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
        await approve("c1", 2026, 10)
        await UserService.update({ id: "e1", salary: 6000, salaryEffective: "THIS_MONTH" } as any, admin("a1", "c1"))
        expect(await changes("e1")).toEqual([[6000, "2026-10-31T22:00:00.000Z"]])
    })

    it("is in the company's calendar: still November in New York, refused by November's approved payroll", async () => {
        // Already 1 December in UTC and in Cairo; 30 November in New York.
        vi.setSystemTime(new Date("2026-12-01T03:00:00Z"))
        await approve("c2", 2026, 11)
        await expect(UserService.update({ id: "e2", salary: 4500, salaryEffective: "THIS_MONTH" } as any, admin("a2", "c2"))).rejects.toThrow("PAYROLL_MONTH_LOCKED")
        await UserService.update({ id: "e2", salary: 4500, salaryEffective: "NEXT_MONTH" } as any, admin("a2", "c2"))
        // 1 December in New York.
        expect(await changes("e2")).toEqual([[4500, "2026-12-01T05:00:00.000Z"]])
    })

    it("dates this month's from the 1st in the company's calendar", async () => {
        vi.setSystemTime(new Date("2026-12-01T03:00:00Z"))
        await UserService.update({ id: "e2", salary: 4500, salaryEffective: "THIS_MONTH" } as any, admin("a2", "c2"))
        // 1 November in New York.
        expect(await changes("e2")).toEqual([[4500, "2026-11-01T04:00:00.000Z"]])
    })
})
