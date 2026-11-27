import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { PayrollDeductionService, DeductionsInvalid } from "@/lib/services/payroll-deduction.service"
import { PayrollRunService } from "@/lib/services/payroll-run.service"

/**
 * Payroll deductions (LATER_CHANGES_PLAN.md §7.12, PR 440; DESIGN.md,
 * Payroll deductions): a company's income tax, social insurance and its own,
 * saved as the card saves them, and taken on each month not approved yet.
 * Against a real Postgres built from the migrations, with made-up people.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Cairo One', now()), ('c2', 'Giza Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", salary, "dayOffCredit", "baseDayOffCredit") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', 0, 0, 0),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 30000, 21, 21),
 ('e2', 'e2@x', 'p', 'Fady', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2', 30000, 21, 21);
`
const AFTER_ALL = `
INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom", reason, "createdAt") VALUES
 ('s1', 'e1', 30000, '2026-01-01T00:00:00Z', 'Starting salary', '2026-01-01T00:00:00Z'),
 ('s2', 'e2', 30000, '2026-01-01T00:00:00Z', 'Starting salary', '2026-01-01T00:00:00Z');
INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
 ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z'),
 ('h2', 'e2', 'HIRED', '2026-01-01T00:00:00Z');
`

/** The company's Admin, as the route has checked them. */
const admin = { user: { id: "a1", role: "ADMIN", companyId: "c1" } }

describe.skipIf(!ADMIN_URL)("payroll deductions, in Postgres", () => {
    const dbName = `payroll_deductions_test_${Date.now()}`
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

    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-15T10:00:00Z")) })
    afterEach(async () => {
        vi.useRealTimers()
        await db.query(`DELETE FROM "PayrollDeduction"`)
        await db.query(`DELETE FROM "PayrollRun"`)
        await db.query(`DELETE FROM "AuditLog" WHERE action = 'UPDATE_PAYROLL_DEDUCTIONS'`)
    })

    const rows = async (companyId = "c1") => (await db.query(
        `SELECT id, kind::text, name, basis::text, value::float AS value, "sortOrder" FROM "PayrollDeduction" WHERE "companyId" = $1 ORDER BY kind, "sortOrder"`, [companyId],
    )).rows
    const lines = async (companyId: string, userId: string) => {
        const { register } = await PayrollRunService.compute(companyId, 2026, 11)
        return register.entries.find(e => e.userId === userId)!.lines.map(l => [l.source, l.label, l.amountMinor / 100])
    }

    it("takes nothing until one's set, so no payslip changes", async () => {
        expect(await PayrollDeductionService.view("c1")).toEqual({ incomeTax: 0, socialInsurance: 0, more: [] })
        expect(await lines("c1", "e1")).toEqual([["SALARY", "Salary", 30000]])
        // Saving 0s adds no row.
        await PayrollDeductionService.save("c1", { incomeTax: "0", socialInsurance: "0", more: [] }, admin)
        expect(await rows()).toEqual([])
    })

    it("saves the card, and takes each one on the month not approved yet, after the salary", async () => {
        const saved = await PayrollDeductionService.save("c1", {
            incomeTax: "10", socialInsurance: "11.25",
            more: [{ name: " Union fee ", basis: "AMOUNT", value: "150" }, { name: "Club", basis: "PERCENT", value: "1" }],
        }, admin)
        expect(saved).toMatchObject({ incomeTax: 10, socialInsurance: 11.25, more: [{ name: "Union fee", basis: "AMOUNT", value: 150 }, { name: "Club", basis: "PERCENT", value: 1 }] })
        expect(await lines("c1", "e1")).toEqual([
            ["SALARY", "Salary", 30000],
            ["INCOME_TAX", "Income tax", 3000],
            ["SOCIAL_INSURANCE", "Social insurance", 3375],
            ["PAYROLL_DEDUCTION", "Union fee", 150],
            ["PAYROLL_DEDUCTION", "Club", 300],
        ])
        // Another company's payslips aren't touched.
        expect(await lines("c2", "e2")).toEqual([["SALARY", "Salary", 30000]])
    })

    it("keeps a deduction's id through a rename, so the people set for it keep it; removes what's gone", async () => {
        const first = await PayrollDeductionService.save("c1", {
            incomeTax: "0", socialInsurance: "0",
            more: [{ name: "Union fee", basis: "AMOUNT", value: "150" }, { name: "Club", basis: "AMOUNT", value: "50" }],
        }, admin)
        const [fee, club] = first.more
        const second = await PayrollDeductionService.save("c1", {
            incomeTax: "0", socialInsurance: "0",
            more: [{ id: fee.id, name: "Syndicate fee", basis: "AMOUNT", value: "175" }],
        }, admin)
        expect(second.more).toEqual([{ id: fee.id, name: "Syndicate fee", basis: "AMOUNT", value: 175 }])
        expect((await rows()).map(r => r.id)).not.toContain(club.id)
    })

    it("keeps the card's order, moved about", async () => {
        const first = await PayrollDeductionService.save("c1", {
            incomeTax: "0", socialInsurance: "0",
            more: [{ name: "A", basis: "AMOUNT", value: "1" }, { name: "B", basis: "AMOUNT", value: "2" }],
        }, admin)
        const [a, b] = first.more
        await PayrollDeductionService.save("c1", {
            incomeTax: "0", socialInsurance: "0",
            more: [{ id: b.id, name: "B", basis: "AMOUNT", value: "2" }, { name: "C", basis: "AMOUNT", value: "3" }, { id: a.id, name: "A", basis: "AMOUNT", value: "1" }],
        }, admin)
        expect((await PayrollDeductionService.view("c1")).more.map(m => m.name)).toEqual(["B", "C", "A"])
        // Kept as the card's order, not left to the order they were written in.
        expect((await rows()).map(r => [r.name, r.sortOrder])).toEqual([["B", 0], ["C", 1], ["A", 2]])
        expect((await lines("c1", "e1")).slice(1).map(l => l[1])).toEqual(["B", "C", "A"])
    })

    it("lets two swap their names in one save", async () => {
        const first = await PayrollDeductionService.save("c1", {
            incomeTax: "0", socialInsurance: "0",
            more: [{ name: "A", basis: "AMOUNT", value: "1" }, { name: "B", basis: "AMOUNT", value: "2" }],
        }, admin)
        const [a, b] = first.more
        const swapped = await PayrollDeductionService.save("c1", {
            incomeTax: "0", socialInsurance: "0",
            more: [{ id: a.id, name: "B", basis: "AMOUNT", value: "1" }, { id: b.id, name: "A", basis: "AMOUNT", value: "2" }],
        }, admin)
        expect(swapped.more.map(m => [m.id, m.name])).toEqual([[a.id, "B"], [b.id, "A"]])
    })

    it("takes an id from another company as a new one, and leaves that company's alone", async () => {
        const theirs = await PayrollDeductionService.save("c2", { incomeTax: "0", socialInsurance: "0", more: [{ name: "Theirs", basis: "AMOUNT", value: "9" }] }, { user: { id: "e2", role: "ADMIN", companyId: "c2" } })
        const mine = await PayrollDeductionService.save("c1", { incomeTax: "0", socialInsurance: "0", more: [{ id: theirs.more[0].id, name: "Mine", basis: "AMOUNT", value: "1" }] }, admin)
        expect(mine.more[0].id).not.toBe(theirs.more[0].id)
        expect((await PayrollDeductionService.view("c2")).more).toEqual(theirs.more)
    })

    it("refuses what's wrong, saving nothing", async () => {
        await expect(PayrollDeductionService.save("c1", {
            incomeTax: "101", socialInsurance: "0",
            more: [{ name: "Fee", basis: "AMOUNT", value: "1" }, { name: "fee", basis: "AMOUNT", value: "2" }],
        }, admin)).rejects.toBeInstanceOf(DeductionsInvalid)
        expect(await rows()).toEqual([])
    })

    it("holds in the database what the schema can't say", async () => {
        const insert = (kind: string, name: string | null, basis: string, value: number) => db.query(
            `INSERT INTO "PayrollDeduction"(id, "companyId", kind, name, basis, value, "updatedAt") VALUES (gen_random_uuid(), 'c1', $1::"PayrollDeductionKind", $2, $3::"PayrollDeductionBasis", $4, now())`,
            [kind, name, basis, value],
        )
        await insert("INCOME_TAX", null, "PERCENT", 10)
        await expect(insert("INCOME_TAX", null, "PERCENT", 12)).rejects.toThrow(/PayrollDeduction_one_built_in/)
        await expect(insert("SOCIAL_INSURANCE", null, "AMOUNT", 10)).rejects.toThrow(/PayrollDeduction_named_own/)
        await expect(insert("SOCIAL_INSURANCE", null, "PERCENT", 101)).rejects.toThrow(/PayrollDeduction_value_range/)
        await expect(insert("OTHER", null, "AMOUNT", 1)).rejects.toThrow(/PayrollDeduction_named_own/)
        await expect(insert("OTHER", "  ", "AMOUNT", 1)).rejects.toThrow(/PayrollDeduction_named_own/)
        await insert("OTHER", "Fee", "AMOUNT", 1)
        await expect(insert("OTHER", " fee ", "AMOUNT", 2)).rejects.toThrow(/PayrollDeduction_own_name/)
        await expect(insert("OTHER", "Club", "AMOUNT", -1)).rejects.toThrow(/PayrollDeduction_value_range/)
        // An amount may be over 100.
        await insert("OTHER", "Big", "AMOUNT", 5000)
        // A company's go with it.
        const { rows: [key] } = await db.query(`SELECT confdeltype FROM pg_constraint WHERE conname = 'PayrollDeduction_companyId_fkey'`)
        expect(key.confdeltype).toBe("c")
    })

    it("has row level security on", async () => {
        const on = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'PayrollDeduction'`)).rows[0].relrowsecurity
        expect(on).toBe(true)
    })

    it("writes each change to the audit log as whoever made it", async () => {
        await PayrollDeductionService.save("c1", { incomeTax: "10", socialInsurance: "0", more: [{ name: "Union fee", basis: "AMOUNT", value: "150" }] }, admin)
        await PayrollDeductionService.save("c1", { incomeTax: "12", socialInsurance: "0", more: [{ name: "Union fee", basis: "PERCENT", value: "1.5" }] }, admin)
        // Saved again unchanged: nothing to log.
        const now = await PayrollDeductionService.view("c1")
        await PayrollDeductionService.save("c1", { incomeTax: "12", socialInsurance: "0", more: now.more.map(m => ({ id: m.id, name: m.name, basis: m.basis, value: String(m.value) })) }, admin)
        const logged = (await db.query(`SELECT "userId", "entityId", details FROM "AuditLog" WHERE action = 'UPDATE_PAYROLL_DEDUCTIONS' ORDER BY "createdAt"`)).rows
        expect(logged).toHaveLength(2)
        expect(logged[0]).toMatchObject({ userId: "a1", entityId: "c1", details: { incomeTax: { old: 0, new: 10 }, payrollDeductionsMore: { old: [], new: ["Union fee: 150.00"] } } })
        expect(logged[1].details).toEqual({ incomeTax: { old: 10, new: 12 }, payrollDeductionsMore: { old: ["Union fee: 150.00"], new: ["Union fee: 1.5%"] } })
    })

    it("approves a month with the deductions it's shown with, and keeps them with it", async () => {
        await PayrollDeductionService.save("c1", { incomeTax: "10", socialInsurance: "0", more: [{ name: "Union fee", basis: "AMOUNT", value: "150" }] }, admin)
        const out = await PayrollRunService.approve("c1", 2026, 10, admin)
        expect(out).toEqual({ runId: expect.any(String) })
        const { rows: [run] } = await db.query(`SELECT "payrollDeductions" FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2026 AND month = 10`)
        expect(run.payrollDeductions).toEqual(await PayrollDeductionService.rules("c1"))
        const { rows: slip } = await db.query(
            `SELECT l.source, l.label, l.amount::float AS amount FROM "PayslipLine" l JOIN "Payslip" p ON p.id = l."payslipId" WHERE p."userId" = 'e1' ORDER BY l."sortOrder"`,
        )
        expect(slip.map(l => [l.source, l.label, l.amount])).toEqual([["SALARY", "Salary", 30000], ["INCOME_TAX", "Income tax", 3000], ["PAYROLL_DEDUCTION", "Union fee", 150]])
        // Changed since, the approved month is shown as it was approved.
        await PayrollDeductionService.save("c1", { incomeTax: "20", socialInsurance: "0", more: [] }, admin)
        const e1 = (await PayrollRunService.view("c1", 2026, 10)).register.entries.find(e => e.userId === "e1")!
        expect(e1.lines.map(l => [l.source, l.amountMinor / 100])).toEqual([["SALARY", 30000], ["INCOME_TAX", 3000], ["PAYROLL_DEDUCTION", 150]])
    })

    it("keeps an approved month as it was approved, whatever's changed since", async () => {
        await PayrollDeductionService.save("c1", { incomeTax: "10", socialInsurance: "0", more: [] }, admin)
        // Approved with income tax at 10%, as approval stores it.
        await db.query(
            `INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt", "payrollDeductions")
             VALUES (gen_random_uuid(), 'c1', 2026, 11, 'APPROVED', 1, now(), $1::jsonb)`,
            [JSON.stringify(await PayrollDeductionService.rules("c1"))],
        )
        await PayrollDeductionService.save("c1", { incomeTax: "20", socialInsurance: "5", more: [] }, admin)
        const view = await PayrollRunService.view("c1", 2026, 11)
        const e1 = view.register.entries.find(e => e.userId === "e1")!
        expect(e1.lines.map(l => [l.source, l.amountMinor / 100])).toEqual([["SALARY", 30000], ["INCOME_TAX", 3000]])
        // A month approved before there were deductions takes none.
        await db.query(`UPDATE "PayrollRun" SET "payrollDeductions" = NULL`)
        const before = (await PayrollRunService.view("c1", 2026, 11)).register.entries.find(e => e.userId === "e1")!
        expect(before.lines.map(l => l.source)).toEqual(["SALARY"])
        // Still a draft, it takes today's.
        await db.query(`UPDATE "PayrollRun" SET status = 'DRAFT'`)
        const draft = (await PayrollRunService.view("c1", 2026, 11)).register.entries.find(e => e.userId === "e1")!
        expect(draft.lines.map(l => [l.source, l.amountMinor / 100])).toEqual([["SALARY", 30000], ["INCOME_TAX", 6000], ["SOCIAL_INSURANCE", 1500]])
    })
})
