import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { PayrollDeductionService } from "@/lib/services/payroll-deduction.service"
import { PersonDeductionService, PersonDeductionsInvalid, DeductionsChanged } from "@/lib/services/person-deduction.service"
import { PayrollRunService } from "@/lib/services/payroll-run.service"
import type { PersonDeductionDraft } from "@/lib/payroll-deductions"

/**
 * A person's payroll deductions (LATER_CHANGES_PLAN.md §7.12, 9b; DESIGN.md
 * §5.5, A person's payroll deductions): each of the company's as the company
 * takes it, their own figure, or not applied, saved as the card saves them
 * and taken on each month not approved yet. Against a real Postgres built
 * from the migrations, with made-up people.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Cairo One', now()), ('c2', 'Giza Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", salary, "dayOffCredit", "baseDayOffCredit") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', 0, 0, 0),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 30000, 21, 21),
 ('e3', 'e3@x', 'p', 'Hana', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', 30000, 21, 21),
 ('e2', 'e2@x', 'p', 'Fady', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2', 30000, 21, 21);
`
const AFTER_ALL = `
INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom", reason, "createdAt") VALUES
 ('s1', 'e1', 30000, '2026-01-01T00:00:00Z', 'Starting salary', '2026-01-01T00:00:00Z'),
 ('s3', 'e3', 30000, '2026-01-01T00:00:00Z', 'Starting salary', '2026-01-01T00:00:00Z'),
 ('s2', 'e2', 30000, '2026-01-01T00:00:00Z', 'Starting salary', '2026-01-01T00:00:00Z');
INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
 ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z'),
 ('h3', 'e3', 'HIRED', '2026-01-01T00:00:00Z'),
 ('h2', 'e2', 'HIRED', '2026-01-01T00:00:00Z');
`

/** The company's Admin, as the route has checked them. */
const admin = { user: { id: "a1", role: "ADMIN", companyId: "c1" } }

/** The card as it was opened, each deduction as the company, with one changed. */
const as = (view: Awaited<ReturnType<typeof PersonDeductionService.view>>, changes: Record<string, Partial<PersonDeductionDraft>> = {}): PersonDeductionDraft[] =>
    view.deductions.map(d => ({ ref: d.ref, basis: d.basis, mode: d.mode, value: d.value === null ? "" : String(d.value), ...changes[d.ref] }))

describe.skipIf(!ADMIN_URL)("a person's payroll deductions, in Postgres", () => {
    const dbName = `person_deductions_test_${Date.now()}`
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
        await db.query(`DELETE FROM "PersonDeduction"`)
        await db.query(`DELETE FROM "PayrollDeduction"`)
        await db.query(`DELETE FROM "PayrollRun"`)
        await db.query(`DELETE FROM "AuditLog" WHERE action IN ('UPDATE_PAYROLL_DEDUCTIONS', 'UPDATE_PERSON_DEDUCTIONS')`)
    })

    const settings = async () => (await db.query(
        `SELECT p."userId", d.kind::text, d.name, p.mode::text, p.value::float AS value FROM "PersonDeduction" p JOIN "PayrollDeduction" d ON d.id = p."deductionId" ORDER BY p."userId", d.kind, d."sortOrder"`,
    )).rows
    const lines = async (userId: string, companyId = "c1") => {
        const { register } = await PayrollRunService.compute(companyId, 2026, 11)
        return register.entries.find(e => e.userId === userId)!.lines.map(l => [l.source, l.label, l.amountMinor / 100])
    }
    const company = (incomeTax: string, socialInsurance: string, more: { id?: string; name: string; basis: "PERCENT" | "AMOUNT"; value: string }[] = []) =>
        PayrollDeductionService.save("c1", { incomeTax, socialInsurance, more }, admin)

    it("lists income tax and social insurance, then the company's own, each as the company, before anything's set", async () => {
        expect(await PersonDeductionService.view("e1")).toEqual({
            deductions: [
                { ref: "INCOME_TAX", kind: "INCOME_TAX", name: null, basis: "PERCENT", company: 0, mode: "COMPANY", value: null },
                { ref: "SOCIAL_INSURANCE", kind: "SOCIAL_INSURANCE", name: null, basis: "PERCENT", company: 0, mode: "COMPANY", value: null },
            ],
        })
        const saved = await company("10", "11", [{ name: "Union fee", basis: "AMOUNT", value: "150" }])
        const view = await PersonDeductionService.view("e1")
        expect(view.deductions.map(d => [d.ref, d.company, d.mode])).toEqual([
            ["INCOME_TAX", 10, "COMPANY"], ["SOCIAL_INSURANCE", 11, "COMPANY"], [saved.more[0].id, 150, "COMPANY"],
        ])
        expect(view.deductions[2]).toMatchObject({ kind: "OTHER", name: "Union fee", basis: "AMOUNT" })
    })

    it("takes their own figure in the company's place on the month not approved yet, and nobody else's", async () => {
        const saved = await company("10", "11", [{ name: "Union fee", basis: "AMOUNT", value: "150" }])
        const fee = saved.more[0].id
        const after = await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), {
            INCOME_TAX: { mode: "OWN", value: "12.5" }, [fee]: { mode: "OWN", value: "50" },
        }), admin)
        expect(after.deductions.map(d => [d.mode, d.value])).toEqual([["OWN", 12.5], ["COMPANY", null], ["OWN", 50]])
        expect(await lines("e1")).toEqual([
            ["SALARY", "Salary", 30000], ["INCOME_TAX", "Income tax", 3750], ["SOCIAL_INSURANCE", "Social insurance", 3300], ["PAYROLL_DEDUCTION", "Union fee", 50],
        ])
        expect(await lines("e3")).toEqual([
            ["SALARY", "Salary", 30000], ["INCOME_TAX", "Income tax", 3000], ["SOCIAL_INSURANCE", "Social insurance", 3300], ["PAYROLL_DEDUCTION", "Union fee", 150],
        ])
        // The company's figure is as it was.
        expect((await PayrollDeductionService.view("c1")).incomeTax).toBe(10)
    })

    it("leaves out one not applied to them, and as the company again, takes it back", async () => {
        await company("10", "11")
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { SOCIAL_INSURANCE: { mode: "NONE" } }), admin)
        expect(await settings()).toEqual([{ userId: "e1", kind: "SOCIAL_INSURANCE", name: null, mode: "NONE", value: null }])
        expect((await lines("e1")).map(l => l[0])).toEqual(["SALARY", "INCOME_TAX"])
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { SOCIAL_INSURANCE: { mode: "COMPANY" } }), admin)
        // As the company is no row at all.
        expect(await settings()).toEqual([])
        expect((await lines("e1")).map(l => l[0])).toEqual(["SALARY", "INCOME_TAX", "SOCIAL_INSURANCE"])
    })

    it("sets their own income tax where the company's is 0 and was never saved, keeping the company's at 0", async () => {
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { INCOME_TAX: { mode: "OWN", value: "5" } }), admin)
        expect((await lines("e1")).map(l => [l[0], l[2]])).toEqual([["SALARY", 30000], ["INCOME_TAX", 1500]])
        expect((await lines("e3")).map(l => l[0])).toEqual(["SALARY"])
        expect(await PayrollDeductionService.view("c1")).toEqual({ incomeTax: 0, socialInsurance: 0, more: [] })
    })

    it("refuses their own figure that isn't one, saving nothing", async () => {
        const saved = await company("10", "0", [{ name: "Union fee", basis: "AMOUNT", value: "150" }])
        const view = await PersonDeductionService.view("e1")
        await expect(PersonDeductionService.save("e1", as(view, { INCOME_TAX: { mode: "OWN", value: "120" } }), admin)).rejects.toBeInstanceOf(PersonDeductionsInvalid)
        await expect(PersonDeductionService.save("e1", as(view, { [saved.more[0].id]: { mode: "OWN", value: "-1" } }), admin)).rejects.toBeInstanceOf(PersonDeductionsInvalid)
        expect(await settings()).toEqual([])
    })

    it("refuses a save made while the company's deductions changed, and says what they are now", async () => {
        const first = await company("10", "0", [{ name: "Union fee", basis: "AMOUNT", value: "150" }])
        const opened = await PersonDeductionService.view("e1")
        const fee = first.more[0].id
        // Another one added since.
        await company("10", "0", [{ id: fee, name: "Union fee", basis: "AMOUNT", value: "150" }, { name: "Club", basis: "PERCENT", value: "1" }])
        const refused = await PersonDeductionService.save("e1", as(opened, { [fee]: { mode: "OWN", value: "50" } }), admin).catch(e => e)
        expect(refused).toBeInstanceOf(DeductionsChanged)
        expect(refused.current).toEqual(await PersonDeductionService.view("e1"))
        // Taken another way since.
        await company("10", "0", [{ id: fee, name: "Union fee", basis: "PERCENT", value: "2" }])
        await expect(PersonDeductionService.save("e1", as(opened, { [fee]: { mode: "OWN", value: "50" } }), admin)).rejects.toBeInstanceOf(DeductionsChanged)
        // Removed since.
        await company("10", "0")
        await expect(PersonDeductionService.save("e1", as(opened, { INCOME_TAX: { mode: "NONE" } }), admin)).rejects.toBeInstanceOf(DeductionsChanged)
        expect(await settings()).toEqual([])
    })

    it("puts anyone with their own figure back on the company's when it changes how one is taken; not applied stays", async () => {
        const first = await company("10", "0", [{ name: "Union fee", basis: "AMOUNT", value: "150" }, { name: "Club", basis: "AMOUNT", value: "20" }])
        const [fee, club] = first.more.map(m => m.id)
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { [fee]: { mode: "OWN", value: "50" }, [club]: { mode: "OWN", value: "5" } }), admin)
        await PersonDeductionService.save("e3", as(await PersonDeductionService.view("e3"), { [fee]: { mode: "NONE" }, INCOME_TAX: { mode: "OWN", value: "8" } }), admin)
        // The fee is a percentage now; the club's figure only changes.
        await company("12", "0", [{ id: fee, name: "Union fee", basis: "PERCENT", value: "1" }, { id: club, name: "Club", basis: "AMOUNT", value: "25" }])
        expect(await settings()).toEqual([
            { userId: "e1", kind: "OTHER", name: "Club", mode: "OWN", value: 5 },
            { userId: "e3", kind: "INCOME_TAX", name: null, mode: "OWN", value: 8 },
            { userId: "e3", kind: "OTHER", name: "Union fee", mode: "NONE", value: null },
        ])
    })

    it("goes with the deduction, and with the person", async () => {
        const first = await company("10", "0", [{ name: "Union fee", basis: "AMOUNT", value: "150" }])
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { [first.more[0].id]: { mode: "OWN", value: "50" }, INCOME_TAX: { mode: "NONE" } }), admin)
        await company("10", "0")
        expect((await settings()).map(s => s.kind)).toEqual(["INCOME_TAX"])
        const keys = (await db.query(`SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('PersonDeduction_userId_fkey', 'PersonDeduction_deductionId_fkey') ORDER BY conname`)).rows
        expect(keys).toEqual([{ conname: "PersonDeduction_deductionId_fkey", confdeltype: "c" }, { conname: "PersonDeduction_userId_fkey", confdeltype: "c" }])
    })

    it("waits for an approval holding the company's row, so the approval keeps what its payslips took", async () => {
        await company("10", "0")
        const opened = await PersonDeductionService.view("e1")
        const approval = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
        await approval.connect()
        try {
            await approval.query("BEGIN")
            await approval.query(`SELECT 1 FROM "Company" WHERE id = 'c1' FOR SHARE`)
            let done = false
            const saving = PersonDeductionService.save("e1", as(opened, { INCOME_TAX: { mode: "NONE" } }), admin).then(() => { done = true })
            await new Promise(r => setTimeout(r, 400))
            expect(done).toBe(false)
            expect(await settings()).toEqual([])
            await approval.query("COMMIT")
            await saving
            expect(done).toBe(true)
        } finally {
            await approval.end()
        }
        expect((await settings()).map(s => s.mode)).toEqual(["NONE"])
    })

    it("holds in the database what the schema can't say", async () => {
        await company("10", "0")
        const { rows: [tax] } = await db.query(`SELECT id FROM "PayrollDeduction" WHERE kind = 'INCOME_TAX'`)
        const insert = (userId: string, mode: string, value: number | null) => db.query(
            `INSERT INTO "PersonDeduction"(id, "userId", "deductionId", mode, value, "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3::"PersonDeductionMode", $4, now())`,
            [userId, tax.id, mode, value],
        )
        await expect(insert("e1", "OWN", null)).rejects.toThrow(/PersonDeduction_figure/)
        await expect(insert("e1", "OWN", -1)).rejects.toThrow(/PersonDeduction_figure/)
        await expect(insert("e1", "NONE", 5)).rejects.toThrow(/PersonDeduction_figure/)
        await insert("e1", "OWN", 5)
        await expect(insert("e1", "NONE", null)).rejects.toThrow(/PersonDeduction_userId_deductionId_key/)
    })

    it("has row level security on", async () => {
        const on = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'PersonDeduction'`)).rows[0].relrowsecurity
        expect(on).toBe(true)
    })

    it("writes each change to the audit log, on the person, as whoever made it", async () => {
        const first = await company("10", "0", [{ name: "Union fee", basis: "AMOUNT", value: "150" }])
        const fee = first.more[0].id
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { INCOME_TAX: { mode: "OWN", value: "12.5" }, [fee]: { mode: "NONE" } }), admin)
        // Saved again unchanged: nothing to log.
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1")), admin)
        const logged = (await db.query(`SELECT "userId", "entityType", "entityId", details FROM "AuditLog" WHERE action = 'UPDATE_PERSON_DEDUCTIONS' ORDER BY "createdAt"`)).rows
        expect(logged).toHaveLength(1)
        expect(logged[0]).toMatchObject({
            userId: "a1", entityType: "USER", entityId: "e1",
            details: { personDeductions: {
                old: ["Income tax: as the company", "Social insurance: as the company", "Union fee: as the company"],
                new: ["Income tax: 12.5%", "Social insurance: as the company", "Union fee: not applied"],
            } },
        })
    })

    it("approves a month with each person's, keeps them with it, and shows it as approved", async () => {
        await company("10", "0")
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { INCOME_TAX: { mode: "OWN", value: "12.5" } }), admin)
        await PersonDeductionService.save("e3", as(await PersonDeductionService.view("e3"), { INCOME_TAX: { mode: "NONE" } }), admin)
        const out = await PayrollRunService.approve("c1", 2026, 10, admin)
        expect(out).toEqual({ runId: expect.any(String) })
        const { rows: [run] } = await db.query(`SELECT "personDeductions" FROM "PayrollRun" WHERE "companyId" = 'c1' AND year = 2026 AND month = 10`)
        const { rows: [tax] } = await db.query(`SELECT id FROM "PayrollDeduction" WHERE kind = 'INCOME_TAX'`)
        expect(run.personDeductions).toEqual({
            e1: [{ deductionId: tax.id, mode: "OWN", value: 12.5 }],
            e3: [{ deductionId: tax.id, mode: "NONE", value: null }],
        })
        const slip = async (userId: string) => (await db.query(
            `SELECT l.source, l.amount::float AS amount FROM "PayslipLine" l JOIN "Payslip" p ON p.id = l."payslipId" WHERE p."userId" = $1 ORDER BY l."sortOrder"`, [userId],
        )).rows.map(l => [l.source, l.amount])
        expect(await slip("e1")).toEqual([["SALARY", 30000], ["INCOME_TAX", 3750]])
        expect(await slip("e3")).toEqual([["SALARY", 30000]])
        // Changed since, the approved month is shown as it was approved.
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { INCOME_TAX: { mode: "NONE" } }), admin)
        await PersonDeductionService.save("e3", as(await PersonDeductionService.view("e3"), { INCOME_TAX: { mode: "COMPANY" } }), admin)
        const view = await PayrollRunService.view("c1", 2026, 10)
        const shown = (userId: string) => view.register.entries.find(e => e.userId === userId)!.lines.map(l => [l.source, l.amountMinor / 100])
        expect(shown("e1")).toEqual([["SALARY", 30000], ["INCOME_TAX", 3750]])
        expect(shown("e3")).toEqual([["SALARY", 30000]])
    })

    it("shows a month approved before people had their own with the company's for everyone", async () => {
        await company("10", "0")
        await db.query(
            `INSERT INTO "PayrollRun"(id, "companyId", year, month, status, "payrollDay", "updatedAt", "payrollDeductions")
             VALUES (gen_random_uuid(), 'c1', 2026, 11, 'APPROVED', 1, now(), $1::jsonb)`,
            [JSON.stringify(await PayrollDeductionService.rules("c1"))],
        )
        await PersonDeductionService.save("e1", as(await PersonDeductionService.view("e1"), { INCOME_TAX: { mode: "OWN", value: "20" } }), admin)
        const e1 = (await PayrollRunService.view("c1", 2026, 11)).register.entries.find(e => e.userId === "e1")!
        expect(e1.lines.map(l => [l.source, l.amountMinor / 100])).toEqual([["SALARY", 30000], ["INCOME_TAX", 3000]])
        // Still a draft, it takes today's.
        await db.query(`UPDATE "PayrollRun" SET status = 'DRAFT'`)
        const draft = (await PayrollRunService.view("c1", 2026, 11)).register.entries.find(e => e.userId === "e1")!
        expect(draft.lines.map(l => [l.source, l.amountMinor / 100])).toEqual([["SALARY", 30000], ["INCOME_TAX", 6000]])
    })
})
