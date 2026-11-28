import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { SalaryAdvancePolicyService, SalaryAdvancePolicyInvalid } from "@/lib/services/salary-advance-policy.service"

/**
 * The rules a salary advance follows (LATER_CHANGES_PLAN.md §7.5, step 2;
 * DESIGN.md §5.5, Salary advances): columns on the company, with their
 * defaults for every company already there, saved as the card saves them
 * and written to the audit log. Against a real Postgres built from the
 * migrations, with made-up companies.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const OWN = "20270130000000_salary_advance_policy"

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Cairo One', now()), ('c2', 'Giza Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", salary, "dayOffCredit", "baseDayOffCredit") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', 0, 0, 0);
`

/** The company's Admin, as the route has checked them. */
const admin = { user: { id: "a1", role: "ADMIN", companyId: "c1" } }
const DEFAULTS = { maxMonths: 2, minServiceMonths: 3, oneOpen: true, installmentPercent: 10, debtsPercent: 25, overLimit: "BLOCK" }
const card = { maxMonths: "1.5", minServiceMonths: "6", oneOpen: false, installmentPercent: "12.5", debtsPercent: "30", overLimit: "WARN" as const }

describe.skipIf(!ADMIN_URL)("the salary advance rules, in Postgres", () => {
    const dbName = `salary_advance_policy_test_${Date.now()}`
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
        expect(MIGRATIONS).toContain(OWN)
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
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

    afterEach(async () => {
        await db.query(`UPDATE "Company" SET "salaryAdvanceMaxMonths" = DEFAULT, "salaryAdvanceMinServiceMonths" = DEFAULT, "salaryAdvanceOneOpen" = DEFAULT,
            "salaryAdvanceInstallmentPercent" = DEFAULT, "debtsLimitPercent" = DEFAULT, "salaryAdvanceOverLimit" = DEFAULT`)
        await db.query(`DELETE FROM "AuditLog" WHERE action = 'UPDATE_SALARY_ADVANCE_POLICY'`)
    })

    it("gives every company already there the defaults", async () => {
        expect(await SalaryAdvancePolicyService.view("c1")).toEqual(DEFAULTS)
        expect(await SalaryAdvancePolicyService.view("c2")).toEqual(DEFAULTS)
        expect(await SalaryAdvancePolicyService.view("nope")).toBeNull()
    })

    it("only adds to the company: a migration of its own, each column with its default", async () => {
        const own = sql(OWN)
        expect(own).not.toMatch(/\bDROP\b|\bRENAME\b|\bUPDATE\b|\bDELETE\b/i)
        const { rows } = await db.query(
            `SELECT column_name, column_default, is_nullable FROM information_schema.columns
             WHERE table_name = 'Company' AND column_name IN ('salaryAdvanceMaxMonths', 'salaryAdvanceMinServiceMonths', 'salaryAdvanceOneOpen',
               'salaryAdvanceInstallmentPercent', 'debtsLimitPercent', 'salaryAdvanceOverLimit') ORDER BY column_name`,
        )
        expect(rows).toHaveLength(6)
        for (const r of rows) {
            expect(r.is_nullable, r.column_name).toBe("NO")
            expect(r.column_default, r.column_name).not.toBeNull()
        }
    })

    it("is refused by the database too, out of range or with all debts below an installment", async () => {
        for (const set of [
            `"salaryAdvanceMaxMonths" = 0.4`, `"salaryAdvanceMaxMonths" = 12.5`,
            `"salaryAdvanceMinServiceMonths" = -1`, `"salaryAdvanceMinServiceMonths" = 121`,
            `"salaryAdvanceInstallmentPercent" = 0`, `"debtsLimitPercent" = 101`,
            `"salaryAdvanceInstallmentPercent" = 30, "debtsLimitPercent" = 25`,
        ]) {
            const refused = await db.query(`UPDATE "Company" SET ${set} WHERE id = 'c1'`).catch(e => e)
            expect(refused, set).toBeInstanceOf(Error)
            expect(String(refused.message), set).toMatch(/Company_salaryAdvance_check/)
        }
        expect(await SalaryAdvancePolicyService.view("c1")).toEqual(DEFAULTS)
    })

    it("saves the card for its own company only, figures with their decimals", async () => {
        const saved = await SalaryAdvancePolicyService.save("c1", card, admin)
        expect(saved).toEqual({ maxMonths: 1.5, minServiceMonths: 6, oneOpen: false, installmentPercent: 12.5, debtsPercent: 30, overLimit: "WARN" })
        expect(await SalaryAdvancePolicyService.view("c1")).toEqual(saved)
        expect(await SalaryAdvancePolicyService.view("c2")).toEqual(DEFAULTS)
        // Arabic digits, as the card may send them.
        expect((await SalaryAdvancePolicyService.save("c1", { ...card, maxMonths: "١٫٢٥", minServiceMonths: "٠" }, admin))).toMatchObject({ maxMonths: 1.25, minServiceMonths: 0 })
    })

    it("refuses what's typed wrong, under each field, and changes nothing", async () => {
        const refused = await SalaryAdvancePolicyService.save("c1", { ...card, maxMonths: "13", installmentPercent: "40" }, admin).catch(e => e)
        expect(refused).toBeInstanceOf(SalaryAdvancePolicyInvalid)
        expect(refused.errors).toEqual({ maxMonths: "salary_advance_months_invalid", debtsPercent: "salary_advance_debts_below" })
        expect(await SalaryAdvancePolicyService.view("c1")).toEqual(DEFAULTS)
        expect((await db.query(`SELECT 1 FROM "AuditLog" WHERE action = 'UPDATE_SALARY_ADVANCE_POLICY'`)).rows).toEqual([])
    })

    it("writes what changed to the audit log, on the company, as whoever changed it", async () => {
        await SalaryAdvancePolicyService.save("c1", card, admin)
        await SalaryAdvancePolicyService.save("c1", { ...card, debtsPercent: "35" }, admin)
        // Saved again unchanged, as typed differently: nothing to log.
        await SalaryAdvancePolicyService.save("c1", { ...card, debtsPercent: "35.00", maxMonths: "1.50" }, admin)
        const logged = (await db.query(`SELECT "userId", "entityType", "entityId", details FROM "AuditLog" WHERE action = 'UPDATE_SALARY_ADVANCE_POLICY' ORDER BY "createdAt"`)).rows
        expect(logged).toHaveLength(2)
        expect(logged[0]).toMatchObject({ userId: "a1", entityType: "COMPANY", entityId: "c1" })
        expect(logged[0].details).toEqual({
            salaryAdvanceMaxMonths: { old: 2, new: 1.5 },
            salaryAdvanceMinServiceMonths: { old: 3, new: 6 },
            salaryAdvanceOneOpen: { old: true, new: false },
            salaryAdvanceInstallmentPercent: { old: 10, new: 12.5 },
            debtsLimitPercent: { old: 25, new: 30 },
            salaryAdvanceOverLimit: { old: "BLOCK", new: "WARN" },
        })
        expect(logged[1].details).toEqual({ debtsLimitPercent: { old: 30, new: 35 } })
    })
})
