import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Costs paid from cash advances (CLIENTS_PLAN.md §7.2, §7.4, step 7b),
 * against a real Postgres: a cost added is paid from its author's advance
 * first, only the rest is to be paid back, removing a cost or deleting its
 * task puts its part back, and Mark all as paid pays only what's owed.
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
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`
// Tasks with no client, so their costs are no one's charges; Ehab on three, Eman on one.
const TASKS = `
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "locationId", "updatedAt") VALUES
 ('k1', 'Fix the gate', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('k2', 'Paint the office', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('k3', 'Move the shelves', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now()),
 ('k4', 'Clean the yard', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'port', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('k1', 'e1'), ('k2', 'e2'), ('k3', 'e1'), ('k4', 'e1');
`

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" })
const ehab = as({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" })
const eman = as({ id: "e2", role: "EMPLOYEE", companyId: "c1", name: "Eman One" })
const PAGE = { page: 1, limit: 50, skip: 0 }

describe.skipIf(!ADMIN_URL)("costs paid from cash advances, in Postgres", () => {
    const dbName = `advance_spending_test_${Date.now()}`
    let db: Client
    let Advances: typeof import("@/lib/services/cash-advance.service").CashAdvanceService
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let Companies: typeof import("@/lib/services/company.service").CompanyService
    let snapshotOf: typeof import("@/lib/services/costs-query").snapshotOf
    let prisma: typeof import("@/lib/prisma").prisma

    const balance = async (userId: string) => (await Advances.person(admin.user, userId, PAGE)).balance
    const task = async (id: string) => (await db.query(`SELECT "totalCost"::float AS total, "memberCosts" AS shares, "memberPaymentStatus" AS paid FROM "Task" WHERE id = $1`, [id])).rows[0]
    const costs = async (id: string) => (await db.query(`SELECT description, amount::float, "fromAdvance"::float AS advance FROM "TaskCost" WHERE "taskId" = $1 ORDER BY amount DESC, description`, [id])).rows
    const add = (taskId: string, session: any, ...amounts: number[]) =>
        Tasks.submit(taskId, session.user.id, session, { isDraft: true, costs: amounts.map((amount, i) => ({ amount, description: `${taskId} cost ${i + 1}` })) })

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
        await db.query(TASKS)
        await db.query(`UPDATE "Company" SET "cashAdvancesAllowed" = true WHERE id = 'c1'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Advances = (await import("@/lib/services/cash-advance.service")).CashAdvanceService
        Tasks = (await import("@/lib/services/task.service")).TaskService
        Companies = (await import("@/lib/services/company.service")).CompanyService
        snapshotOf = (await import("@/lib/services/costs-query")).snapshotOf
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

    it("pays a cost from its author's advance first, and only the rest is to be paid back", async () => {
        await Advances.record(admin, "e1", { kind: "GIVEN", amount: 1000, date: "2026-10-01" })
        await add("k1", ehab, 300, 200)
        expect(await costs("k1")).toEqual([
            { description: "k1 cost 1", amount: 300, advance: 300 },
            { description: "k1 cost 2", amount: 200, advance: 200 },
        ])
        // Nothing to pay back yet: the advance paid it all.
        expect(await task("k1")).toMatchObject({ total: 0 })
        expect((await task("k1")).shares?.e1 ?? 0).toBe(0)
        expect(await balance("e1")).toBe(500)

        // 400 and 300 more: 400 and the last 100 from the advance, 200 to pay back.
        await add("k1", ehab, 400, 300)
        expect((await costs("k1")).map(c => [c.amount, c.advance])).toEqual([[400, 400], [300, 300], [300, 100], [200, 200]])
        expect(await task("k1")).toMatchObject({ total: 200, shares: { e1: 200 }, paid: { e1: "PENDING_PAYMENT" } })
        expect(await balance("e1")).toBe(0)
    })

    it("records each part taken as a Spent entry on its cost and task, in the person's history", async () => {
        const { rows } = await db.query(`SELECT e.amount::float, e."taskId", c."fromAdvance"::float AS part FROM "CashAdvanceEntry" e JOIN "TaskCost" c ON c.id = e."costId" WHERE e.kind = 'SPENT' ORDER BY e.amount`)
        expect(rows).toEqual([
            { amount: -400, taskId: "k1", part: 400 },
            { amount: -300, taskId: "k1", part: 300 },
            { amount: -200, taskId: "k1", part: 200 },
            { amount: -100, taskId: "k1", part: 100 },
        ])
        const history = (await Advances.person(ehab.user, "e1", PAGE)).data
        expect(history.filter(e => e.kind === "SPENT").every(e => e.task?.title === "Fix the gate")).toBe(true)
    })

    it("has Mark all as paid pay only what's owed, never what the advance paid", async () => {
        const held = await prisma.task.findMany({ where: { id: "k1" }, select: { id: true, totalCost: true, memberCosts: true, memberPaymentStatus: true } })
        expect(snapshotOf(held, "e1")).toMatchObject({ count: 1, amount: 200 })
        expect(snapshotOf(held)).toMatchObject({ count: 1, amount: 200 })
        // Someone with no advance is paid back in full, as before.
        await add("k2", eman, 500)
        expect(await costs("k2")).toEqual([{ description: "k2 cost 1", amount: 500, advance: 0 }])
        expect(await task("k2")).toMatchObject({ total: 500, shares: { e2: 500 } })
    })

    it("puts a removed cost's part back on the balance, and takes off only the rest", async () => {
        const [big] = (await db.query(`SELECT id FROM "TaskCost" WHERE "taskId" = 'k1' AND amount = 400`)).rows
        await Tasks.deleteItem("k1", ehab, { type: "COST", itemId: big.id })
        // Wholly from the advance: nothing came off what's to be paid back.
        expect(await task("k1")).toMatchObject({ total: 200, shares: { e1: 200 } })
        expect(await balance("e1")).toBe(400)
        const [split] = (await db.query(`SELECT id FROM "TaskCost" WHERE "taskId" = 'k1' AND "fromAdvance" = 100`)).rows
        await Tasks.deleteItem("k1", ehab, { type: "COST", itemId: split.id })
        expect(await task("k1")).toMatchObject({ total: 0, shares: { e1: 0 } })
        expect(await balance("e1")).toBe(500)
        // Both kept: what was spent, and what came back, on the task still.
        const { rows } = await db.query(`SELECT amount::float, "taskId", "costId" FROM "CashAdvanceEntry" WHERE kind = 'SPENT' AND amount > 0 ORDER BY amount`)
        expect(rows).toEqual([{ amount: 100, taskId: "k1", costId: null }, { amount: 400, taskId: "k1", costId: null }])
    })

    it("puts every cost's part back when their task is deleted", async () => {
        await add("k3", ehab, 120, 30)
        expect(await balance("e1")).toBe(350)
        await Tasks.delete("k3", admin)
        expect(await balance("e1")).toBe(500)
        expect((await db.query(`SELECT count(*)::int AS n FROM "CashAdvanceEntry" WHERE kind = 'SPENT' AND amount > 0 AND "taskId" IS NULL`)).rows[0].n).toBe(2)
    })

    it("takes one person's costs on two tasks at once one after the other, so together they never spend more than is held", async () => {
        await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('k2', 'e1')`)
        // 500 held; 300 on each of two tasks at once: 500 from the advance between them, 100 to pay back.
        await Promise.all([add("k2", ehab, 300), add("k4", ehab, 300)])
        expect(await balance("e1")).toBe(0)
        const { rows } = await db.query(`SELECT sum("fromAdvance")::float AS advance, sum(amount - "fromAdvance")::float AS owed FROM "TaskCost" WHERE "authorId" = 'e1' AND "taskId" IN ('k2', 'k4')`)
        expect(rows[0]).toEqual({ advance: 300 + 200, owed: 100 })
    })

    it("pays costs back in full where cash advances aren't used", async () => {
        await Advances.record(admin, "e1", { kind: "GIVEN", amount: 50, date: "2026-10-02" })
        await Advances.record(admin, "e1", { kind: "RETURNED", amount: 50, date: "2026-10-02" })
        await Companies.update({ id: "c1", cashAdvancesOn: false }, admin)
        await add("k4", ehab, 70)
        expect((await costs("k4")).find(c => c.amount === 70)).toMatchObject({ advance: 0 })
        await Companies.update({ id: "c1", cashAdvancesOn: true }, admin)
    })

    it("offers whoever pays costs what's owed to the person at hand-over, as Mark all as paid pays it", async () => {
        await db.query(`UPDATE "Task" SET status = 'APPROVED' WHERE id IN ('k2', 'k4')`)
        const { owed } = await Advances.person(admin.user, "e1", PAGE)
        // 100 and 70 of Ehab's costs to pay back; nothing the advance paid, nor Eman's 500.
        expect(owed?.amount).toBe(170)
        const held = await prisma.task.findMany({ where: { id: { in: ["k2", "k4"] } }, select: { id: true, totalCost: true, memberCosts: true, memberPaymentStatus: true } })
        expect(owed?.digest).toBe(snapshotOf(held, "e1").digest)
        // Never on one's own advance, and nothing when nothing is owed.
        expect((await Advances.person(ehab.user, "e1", PAGE)).owed).toBeNull()
        await db.query(`UPDATE "Task" SET status = 'IN_PROGRESS' WHERE id IN ('k2', 'k4')`)
        expect((await Advances.person(admin.user, "e1", PAGE)).owed).toBeNull()
    })

    it("holds a cost's part to the cost, in the database too", async () => {
        const [row] = (await db.query(`SELECT id FROM "TaskCost" WHERE "taskId" = 'k2' LIMIT 1`)).rows
        await expect(db.query(`UPDATE "TaskCost" SET "fromAdvance" = amount + 1 WHERE id = '${row.id}'`)).rejects.toThrow(/TaskCost_fromAdvance_check/)
        await expect(db.query(`UPDATE "TaskCost" SET "fromAdvance" = -1 WHERE id = '${row.id}'`)).rejects.toThrow(/TaskCost_fromAdvance_check/)
        await expect(db.query(`INSERT INTO "CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "recordedById") VALUES ('z', 'c1', 'e1', 'SPENT', 0, '2026-10-01', 'a1')`)).rejects.toThrow(/CashAdvanceEntry_amount_check/)
        await expect(db.query(`INSERT INTO "CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "recordedById", "taskId") VALUES ('z', 'c1', 'e1', 'GIVEN', 5, '2026-10-01', 'a1', 'k1')`)).rejects.toThrow(/CashAdvanceEntry_spent_check/)
    })
})
