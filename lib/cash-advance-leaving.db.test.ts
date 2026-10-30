import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Leaving the company with a cash advance still held (CLIENTS_PLAN.md §7.3,
 * step 7d), against a real Postgres: ending the contract turns what's held
 * into a debt, its source the advance, recovered from the final settlement
 * as other debts are, and what it can't cover stays outstanding.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ exists: async () => ({ data: true }), remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e4', 'e4@x', 'p', 'Enas', 'One', 'EMPLOYEE', 2026, 'e4', 'c1', NULL),
 ('e5', 'e5@x', 'p', 'Ezz', 'One', 'EMPLOYEE', 2026, 'e5', 'c1', NULL),
 ('e6', 'e6@x', 'p', 'Eid', 'One', 'EMPLOYEE', 2026, 'e6', 'c1', NULL);
`
// Hired in January. Ehab and Essam earn 9,300 a month, Eman 310: a
// settlement of 6,000 for twenty days of October, or 200. Enas holds nothing.
const SALARIES = `
INSERT INTO "EmploymentEvent"(id, "userId", type, "effectiveFrom") VALUES
 ('h1', 'e1', 'HIRED', '2026-01-01T00:00:00Z'), ('h2', 'e2', 'HIRED', '2026-01-01T00:00:00Z'),
 ('h3', 'e3', 'HIRED', '2026-01-01T00:00:00Z'), ('h4', 'e4', 'HIRED', '2026-01-01T00:00:00Z'),
 ('h5', 'e5', 'HIRED', '2026-01-01T00:00:00Z'), ('h6', 'e6', 'HIRED', '2026-01-01T00:00:00Z');
INSERT INTO "SalaryChange"(id, "userId", "monthlyAmount", "effectiveFrom") VALUES
 ('s1', 'e1', 9300, '2026-01-01T00:00:00Z'), ('s2', 'e2', 310, '2026-01-01T00:00:00Z'),
 ('s3', 'e3', 9300, '2026-01-01T00:00:00Z'), ('s4', 'e4', 9300, '2026-01-01T00:00:00Z'),
 ('s5', 'e5', 9300, '2026-01-01T00:00:00Z'), ('s6', 'e6', 9300, '2026-01-01T00:00:00Z');
`
// A task Eid works on, whose cost his advance pays.
const TASK = `
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "locationId", "updatedAt") VALUES ('k1', 'Fix the gate', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('k1', 'e6');
`
// Before the payday, so nothing of October was paid yet.
const LAST_DAY = "2026-10-20"

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" })

describe.skipIf(!ADMIN_URL)("leaving with a cash advance held, in Postgres", () => {
    const dbName = `advance_leaving_test_${Date.now()}`
    let dbUrl: string
    let db: Client
    let Advances: typeof import("@/lib/services/cash-advance.service").CashAdvanceService
    let Settlements: typeof import("@/lib/services/settlement.service").SettlementService
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let prisma: typeof import("@/lib/prisma").prisma

    const give = (userId: string, amount: number) => Advances.record(admin, userId, { kind: "GIVEN", amount, date: "2026-10-01" })
    const held = (userId: string) => Advances.heldBy("c1", userId)
    const end = (userId: string) => Settlements.settleAndEnd({ userId, lastWorkingDay: LAST_DAY, createdById: "a1", actorRole: "ADMIN", actorName: "Amal One" })
    const debtsOf = async (userId: string) => (await db.query(`SELECT amount::float, "recoveredAmount"::float AS recovered, status, source, "sourceId" FROM "Debt" WHERE "userId" = $1 ORDER BY "createdAt"`, [userId])).rows

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        dbUrl = url.toString()
        db = new Client({ connectionString: dbUrl })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(SALARIES)
        await db.query(TASK)
        await db.query(`UPDATE "Company" SET "cashAdvancesAllowed" = true WHERE id = 'c1'`)
        process.env.POSTGRES_PRISMA_URL = dbUrl
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

    it("counts what's held as a debt the settlement recovers, before the contract ends", async () => {
        await give("e1", 1000)
        const preview = await Settlements.preview("e1", LAST_DAY)
        expect(preview.cashAdvanceHeldMinor).toBe(100_000)
        expect(preview.debtsOutstandingMinor).toBe(100_000)
        expect(preview.debtRecoveredMinor).toBe(100_000)
        expect(preview.payableMinor).toBe(preview.netMinor - 100_000)
    })

    it("turns it into a debt as the contract ends, recovered from the settlement, and the balance into nothing", async () => {
        const { advanceDebt, settlement } = await end("e1")
        expect(await held("e1")).toBe(0)
        const [debt] = await debtsOf("e1")
        expect(debt).toMatchObject({ amount: 1000, recovered: 1000, status: "SETTLED", source: "CASH_ADVANCE", sourceId: expect.any(String) })
        expect(advanceDebt?.amount.toString()).toBe("1000")
        expect(Number(settlement.debtRecoveredAmount)).toBe(1000)
        // The entry that took it there, which the debt names, in their history.
        const { rows } = await db.query(`SELECT kind, amount::float, "recordedByName" FROM "CashAdvanceEntry" WHERE id = $1`, [debt.sourceId])
        expect(rows).toEqual([{ kind: "DEBT", amount: -1000, recordedByName: "Amal One" }])
        const history = (await Advances.person(admin.user, "e1", { page: 1, limit: 20, skip: 0 })).data
        expect(history[0]).toMatchObject({ kind: "DEBT", amount: -1000 })
    })

    it("leaves outstanding what the settlement can't cover, to collect or write off", async () => {
        await give("e2", 1000)
        await end("e2")
        expect(await held("e2")).toBe(0)
        expect(await debtsOf("e2")).toEqual([expect.objectContaining({ amount: 1000, recovered: 200, status: "OUTSTANDING", source: "CASH_ADVANCE" })])
    })

    it("makes no debt for someone holding nothing", async () => {
        const { advanceDebt } = await end("e4")
        expect(advanceDebt).toBeNull()
        expect(await debtsOf("e4")).toEqual([])
        expect((await db.query(`SELECT count(*)::int AS n FROM "CashAdvanceEntry" WHERE "userId" = 'e4'`)).rows[0].n).toBe(0)
    })

    it("ends nothing when the advance changed after the settlement was worked out", async () => {
        await give("e3", 1000)
        // A return being recorded, under the hold on Essam's advance, as the contract is ended.
        const returning = new Client({ connectionString: dbUrl })
        await returning.connect()
        await returning.query("BEGIN")
        await returning.query(`SELECT pg_advisory_xact_lock(hashtextextended('cash-advance:e3', 0))`)
        await returning.query(`INSERT INTO "CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "recordedById") VALUES ('r3', 'c1', 'e3', 'RETURNED', -100, '2026-10-02', 'a1')`)
        const ending = end("e3").then(() => "ended", (e: Error) => e.message)
        // Once the ending waits on the advance, the return commits.
        for (let i = 0; i < 100; i++) {
            if ((await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n > 0) break
            await new Promise(r => setTimeout(r, 100))
        }
        await returning.query("COMMIT")
        await returning.end()
        expect(await ending).toBe("CASH_ADVANCE_CHANGED")
        expect(await held("e3")).toBe(900)
        expect(await debtsOf("e3")).toEqual([])
        expect((await db.query(`SELECT count(*)::int AS n FROM "FinalSettlement" WHERE "userId" = 'e3'`)).rows[0].n).toBe(0)
        // Looked at again, it ends, with the 900 that's held.
        await end("e3")
        expect(await debtsOf("e3")).toEqual([expect.objectContaining({ amount: 900, recovered: 900, status: "SETTLED" })])
    }, 60_000)

    it("turns what's held when a future ending takes effect into a debt too, as they're archived", async () => {
        // Ezz leaves in December, so works on meanwhile, and is given another advance after the ending is recorded.
        await give("e5", 300)
        await Settlements.settleAndEnd({ userId: "e5", lastWorkingDay: "2026-12-10", createdById: "a1", actorRole: "ADMIN", actorName: "Amal One" })
        expect(await held("e5")).toBe(0)
        await give("e5", 200)
        expect(await held("e5")).toBe(200)

        const Employment = (await import("@/lib/services/employment.service")).EmploymentService
        await Employment.applyDueEvents(new Date("2026-12-20T12:00:00Z"))
        expect((await db.query(`SELECT status FROM "User" WHERE id = 'e5'`)).rows[0].status).toBe("ARCHIVED")
        expect(await held("e5")).toBe(0)
        // Recorded as the ending was: by whoever recorded it.
        const debts = await debtsOf("e5")
        expect(debts.map(d => [d.amount, d.status, d.source])).toEqual([[300, "SETTLED", "CASH_ADVANCE"], [200, "OUTSTANDING", "CASH_ADVANCE"]])
        const { rows } = await db.query(`SELECT kind, amount::float, "recordedById", "recordedByName" FROM "CashAdvanceEntry" WHERE id = $1`, [debts[1].sourceId])
        expect(rows).toEqual([{ kind: "DEBT", amount: -200, recordedById: "a1", recordedByName: "Amal One" }])
    })

    it("turns what comes back to someone gone into a debt at once: a cost's part put back, or a correction", async () => {
        // Eid's advance pays his 100 cost, so he holds nothing as he leaves.
        const eid = as({ id: "e6", role: "EMPLOYEE", companyId: "c1", name: "Eid One" })
        await give("e6", 100)
        await Tasks.submit("k1", "e6", eid, { isDraft: true, costs: [{ amount: 100, description: "Gate parts" }] })
        expect(await held("e6")).toBe(0)
        await end("e6")
        expect((await db.query(`SELECT status FROM "User" WHERE id = 'e6'`)).rows[0].status).toBe("ARCHIVED")
        expect(await debtsOf("e6")).toEqual([])

        // The cost is removed after he's gone: its 100 comes back to him, and is a debt.
        const [cost] = (await db.query(`SELECT id FROM "TaskCost" WHERE "taskId" = 'k1'`)).rows
        await Tasks.deleteItem("k1", admin, { type: "COST", itemId: cost.id })
        expect(await held("e6")).toBe(0)
        expect((await debtsOf("e6")).map(d => [d.amount, d.status, d.source])).toEqual([[100, "OUTSTANDING", "CASH_ADVANCE"]])

        // So is a correction finding he held more.
        await Advances.record(admin, "e6", { kind: "CORRECTION", amount: 30, date: "2026-10-25", note: "Counted short on the hand-over" })
        expect(await held("e6")).toBe(0)
        expect((await debtsOf("e6")).map(d => d.amount)).toEqual([100, 30])
    })

    it("holds a debt's entry to taking the balance down, in the database too", async () => {
        await expect(db.query(`INSERT INTO "CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "recordedById") VALUES ('z', 'c1', 'e1', 'DEBT', 5, '2026-10-01', 'a1')`)).rejects.toThrow(/CashAdvanceEntry_amount_check/)
    })
})
