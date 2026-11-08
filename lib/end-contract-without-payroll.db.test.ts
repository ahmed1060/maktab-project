import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Ending a contract where the company's package doesn't include HR
 * (DESIGN.md §5.5, Dialog; CLIENTS_PLAN.md §7.3), against a real Postgres.
 * A settlement is payroll's statement, and its debts are payroll's to
 * recover, and such a company has neither: the ending is all that's
 * recorded. What they still hold of a cash advance stays on it, on the Cash
 * advances tab, until its return is recorded. It became a debt no screen
 * there shows, and the settlement was recorded all the same.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ exists: async () => ({ data: true }), remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

// Ops is sold Company Management only; Full has HR too.
const PEOPLE = `
INSERT INTO "Package"(id, name, "hasCompanyManagement", "hasHR", "updatedAt") VALUES ('ops', 'Operations', true, false, now()), ('full', 'Full', true, true, now());
INSERT INTO "Company"(id, name, "updatedAt", "packageId") VALUES ('c1', 'Ops', now(), 'ops'), ('c2', 'Full', now(), 'full');
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e4', 'e4@x', 'p', 'Eid', 'One', 'EMPLOYEE', 2026, 'e4', 'c1', NULL),
 ('e5', 'e5@x', 'p', 'Ezz', 'One', 'EMPLOYEE', 2026, 'e5', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Amr', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL),
 ('f1', 'f1@x', 'p', 'Fady', 'Two', 'EMPLOYEE', 2026, 'f1', 'c2', NULL);
`
// Hired in January at 9,300 a month, as a company that once had HR would
// have them, but for Ezz, who has no salary on record at all. Eman still
// owes 400 from a payslip of those days.
const RECORDS = `
INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
 ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z'), ('h2', 'e2', 'HIRED', '2026-01-01T00:00:00Z'),
 ('h3', 'e3', 'HIRED', '2026-01-01T00:00:00Z'), ('h4', 'e4', 'HIRED', '2026-01-01T00:00:00Z'),
 ('h5', 'e5', 'HIRED', '2026-01-01T00:00:00Z'), ('h6', 'f1', 'HIRED', '2026-01-01T00:00:00Z');
INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
 ('s1', 'e1', 9300, '2026-01-01T00:00:00Z'), ('s2', 'e2', 9300, '2026-01-01T00:00:00Z'),
 ('s3', 'e3', 9300, '2026-01-01T00:00:00Z'), ('s4', 'e4', 9300, '2026-01-01T00:00:00Z'),
 ('s6', 'f1', 9300, '2026-01-01T00:00:00Z');
INSERT INTO "Debt"(id, "userId", "companyId", amount, source, "sourceId", "dueDate", "updatedAt") VALUES
 ('d2', 'e2', 'c1', 400, 'PAYSLIP', 'old-payslip', '2026-06-25T00:00:00Z', now());
`
// A task Eid works on, whose cost his advance pays.
const TASK = `
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "locationId", "updatedAt") VALUES ('k1', 'Fix the gate', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('k1', 'e4');
`
const LAST_DAY = "2026-10-20"

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" })

describe.skipIf(!ADMIN_URL)("ending a contract without HR, in Postgres", () => {
    const dbName = `end_without_payroll_test_${Date.now()}`
    let db: Client
    let Advances: typeof import("@/lib/services/cash-advance.service").CashAdvanceService
    let Settlements: typeof import("@/lib/services/settlement.service").SettlementService
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let prisma: typeof import("@/lib/prisma").prisma

    const give = (userId: string, amount: number) => Advances.record(admin, userId, { kind: "GIVEN", amount, date: "2026-10-01" })
    const held = (userId: string) => Advances.heldBy("c1", userId)
    const end = (userId: string, lastWorkingDay = LAST_DAY, by = { createdById: "a1", actorRole: "ADMIN", actorName: "Amal One" }) =>
        Settlements.settleAndEnd({ userId, lastWorkingDay, ...by })
    const count = async (table: string, userId: string) => (await db.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = $1`, [userId])).rows[0].n
    const debtsOf = async (userId: string) => (await db.query(`SELECT amount::float, "recoveredAmount"::float AS recovered, status, source FROM "Debt" WHERE "userId" = $1 ORDER BY "createdAt"`, [userId])).rows
    const statusOf = async (userId: string) => (await db.query(`SELECT status FROM "User" WHERE id = $1`, [userId])).rows[0].status

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
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(RECORDS)
        await db.query(TASK)
        await db.query(`UPDATE "Company" SET "cashAdvancesAllowed" = true`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Advances = (await import("@/lib/services/cash-advance.service")).CashAdvanceService
        Settlements = (await import("@/lib/services/settlement.service")).SettlementService
        Tasks = (await import("@/lib/services/task.service")).TaskService
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

    it("works out no settlement: only what they still hold of a cash advance", async () => {
        await give("e1", 1000)
        const preview = await Settlements.preview("e1", LAST_DAY)
        const { endOfContractInstant } = await import("@/lib/employment")
        // Nothing of a statement: no figures, no debts, no payday.
        expect(preview).toEqual({ settles: false, endsAt: endOfContractInstant(LAST_DAY, preview.timeZone), timeZone: preview.timeZone, cashAdvanceHeldMinor: 100_000 })
    })

    it("ends the contract with no settlement and no debt, and leaves what's held on their advance", async () => {
        const { event, settlement, debt, advanceDebt } = await end("e1")
        expect(event).toMatchObject({ type: "CONTRACT_ENDED", userId: "e1" })
        expect([settlement, debt, advanceDebt]).toEqual([null, null, null])
        expect(await statusOf("e1")).toBe("ARCHIVED")
        expect(await count("FinalSettlement", "e1")).toBe(0)
        expect(await debtsOf("e1")).toEqual([])
        expect(await held("e1")).toBe(1000)
        expect((await db.query(`SELECT count(*)::int AS n FROM "CashAdvanceEntry" WHERE "userId" = 'e1' AND kind = 'DEBT'`)).rows[0].n).toBe(0)
        // On the Cash advances tab, as not at work, to have its return recorded there.
        const tab = await Advances.list(admin.user, { holding: true }, { page: 1, limit: 20, skip: 0 })
        expect(tab.data).toEqual([expect.objectContaining({ id: "e1", atWork: false, balance: 1000 })])
        expect(tab.totals.held).toBe(1000)
    })

    it("takes its return once it's handed back", async () => {
        expect(await Advances.record(admin, "e1", { kind: "RETURNED", amount: 1000, date: "2026-10-25" })).toMatchObject({ balance: 0 })
        expect(await held("e1")).toBe(0)
        expect(await debtsOf("e1")).toEqual([])
    })

    it("recovers nothing of the debts they already owe, which no settlement takes", async () => {
        await end("e2")
        expect(await debtsOf("e2")).toEqual([{ amount: 400, recovered: 0, status: "OUTSTANDING", source: "PAYSLIP" }])
        expect(await count("FinalSettlement", "e2")).toBe(0)
    })

    it("asks for no salary, which only a settlement needs", async () => {
        expect(await Settlements.preview("e5", LAST_DAY)).toMatchObject({ settles: false, cashAdvanceHeldMinor: 0 })
        await end("e5")
        expect(await statusOf("e5")).toBe("ARCHIVED")
    })

    it("leaves what's held on their advance as an ending dated ahead takes effect", async () => {
        await give("e3", 300)
        await end("e3", "2026-12-10")
        // At work until then.
        expect(await statusOf("e3")).not.toBe("ARCHIVED")
        // Given another as they work on.
        await give("e3", 200)
        const Employment = (await import("@/lib/services/employment.service")).EmploymentService
        await Employment.applyDueEvents(new Date("2026-12-20T12:00:00Z"))
        expect(await statusOf("e3")).toBe("ARCHIVED")
        expect(await held("e3")).toBe(500)
        expect(await debtsOf("e3")).toEqual([])
    })

    it("puts back on their advance what comes back to them once they've gone: a cost's part, or a correction", async () => {
        // Eid's advance pays his 100 cost, so he holds nothing as he leaves.
        const eid = as({ id: "e4", role: "EMPLOYEE", companyId: "c1", name: "Eid One" })
        await give("e4", 100)
        await Tasks.submit("k1", "e4", eid, { isDraft: true, costs: [{ amount: 100, description: "Gate parts" }] })
        expect(await held("e4")).toBe(0)
        await end("e4")
        expect(await statusOf("e4")).toBe("ARCHIVED")

        const [cost] = (await db.query(`SELECT id FROM "TaskCost" WHERE "taskId" = 'k1'`)).rows
        await Tasks.deleteItem("k1", admin, { type: "COST", itemId: cost.id })
        expect(await held("e4")).toBe(100)
        // The balance it answers with is the one there is.
        expect(await Advances.record(admin, "e4", { kind: "CORRECTION", amount: 30, date: "2026-10-25", note: "Counted short on the hand-over" })).toMatchObject({ balance: 130 })
        expect(await held("e4")).toBe(130)
        expect(await debtsOf("e4")).toEqual([])
    })

    it("still settles where the package includes HR, the cash advance a debt the settlement recovers", async () => {
        const amr = as({ id: "a2", role: "ADMIN", companyId: "c2", name: "Amr Two" })
        await Advances.record(amr, "f1", { kind: "GIVEN", amount: 1000, date: "2026-10-01" })
        expect(await Settlements.preview("f1", LAST_DAY)).toMatchObject({ settles: true, cashAdvanceHeldMinor: 100_000, debtRecoveredMinor: 100_000 })
        const { settlement } = await end("f1", LAST_DAY, { createdById: "a2", actorRole: "ADMIN", actorName: "Amr Two" })
        expect(settlement).not.toBeNull()
        expect(await count("FinalSettlement", "f1")).toBe(1)
        expect(await debtsOf("f1")).toEqual([{ amount: 1000, recovered: 1000, status: "SETTLED", source: "CASH_ADVANCE" }])
        expect(await Advances.heldBy("c2", "f1")).toBe(0)
    })
})
