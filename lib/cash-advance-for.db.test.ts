import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * An advance for a particular task or client (CLIENTS_PLAN.md §7.9, step
 * 7e), against a real Postgres: the ledger holds money for one task or one
 * client beside the running balance; it's given only for a task the person
 * is on and not yet decided, or a client not archived; a return or a
 * correction says which part it's on, and never takes that part below zero;
 * a cost spends the money for its task first, then for its task's client,
 * then the running balance (7f), and goes back on the parts it came from as
 * it's removed; and leaving the company moves each part to the running
 * balance before it becomes a debt.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ exists: async () => ({ data: true }), remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e9', 'e9@x', 'p', 'Ezz', 'Two', 'EMPLOYEE', 2026, 'e9', 'c2', NULL);
`
// Nile Foods is One's client; Old Mill is archived; Delta is Two's. Ehab is
// on the gate and the office, Eman on the shelves; the office is decided.
const WORK = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('nile', 'c1', 'Nile Foods', 'o', '0100', 'HQ', now(), NULL),
 ('mill', 'c1', 'Old Mill', 'o', '0101', 'HQ', now(), now()),
 ('delta', 'c2', 'Delta', 'o', '0102', 'HQ', now(), NULL);
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now()),
 ('far', 'c2', NULL, 'Far', false, 31.18, 29.87, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "locationId", "updatedAt") VALUES
 ('gate', 'Fix the gate', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'nile', 'port', now()),
 ('office', 'Paint the office', 'd', 'APPROVED', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('shelves', 'Move the shelves', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('yard', 'Clean the yard', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('away', 'Elsewhere', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c2', NULL, 'far', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('gate', 'e1'), ('office', 'e1'), ('shelves', 'e2'), ('yard', 'e1'), ('yard', 'e3'), ('away', 'e9');
`

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" })
const ehab = as({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" })
const PAGE = { page: 1, limit: 50, skip: 0 }

describe.skipIf(!ADMIN_URL)("an advance for a task or a client, in Postgres", () => {
    const dbName = `advance_for_test_${Date.now()}`
    let db: Client
    let Advances: typeof import("@/lib/services/cash-advance.service").CashAdvanceService
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let prisma: typeof import("@/lib/prisma").prisma

    const give = (userId: string, amount: number, more: Record<string, unknown> = {}) =>
        Advances.record(admin, userId, { kind: "GIVEN", amount, date: "2026-10-01", ...more })
    const refusal = (p: Promise<unknown>) => p.then(() => "recorded", (e: Error) => e.message)
    const advance = (userId: string) => Advances.person(admin.user, userId, PAGE)

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
        await db.query(WORK)
        await db.query(`UPDATE "Company" SET "cashAdvancesAllowed" = true WHERE id IN ('c1', 'c2')`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Advances = (await import("@/lib/services/cash-advance.service")).CashAdvanceService
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

    it("is given for a task only to someone on it, while it isn't decided, in the company", async () => {
        expect(await refusal(give("e2", 500, { forTaskId: "gate" }))).toBe("CASH_ADVANCE_NOT_ON_TASK")
        expect(await refusal(give("e1", 500, { forTaskId: "office" }))).toBe("CASH_ADVANCE_TASK_DONE")
        expect(await refusal(give("e1", 500, { forTaskId: "away" }))).toBe("CASH_ADVANCE_FOR_INVALID")
        expect(await refusal(give("e1", 500, { forTaskId: "nothing" }))).toBe("CASH_ADVANCE_FOR_INVALID")
        const given = await give("e1", 500, { forTaskId: "gate" })
        expect(given.entry).toMatchObject({ kind: "GIVEN", amount: 500, forTask: { id: "gate", title: "Fix the gate" }, forClient: null })
        expect(given.balance).toBe(500)
    })

    it("is given for a client of the company's, not archived, to anyone at work", async () => {
        expect(await refusal(give("e2", 300, { forClientId: "mill" }))).toBe("CASH_ADVANCE_CLIENT_ARCHIVED")
        expect(await refusal(give("e2", 300, { forClientId: "delta" }))).toBe("CASH_ADVANCE_FOR_INVALID")
        const given = await give("e2", 300, { forClientId: "nile" })
        expect(given.entry).toMatchObject({ forTask: null, forClient: { id: "nile", name: "Nile Foods" } })
        // For one, never both.
        expect(await refusal(give("e2", 300, { forTaskId: "shelves", forClientId: "nile" }))).toBe("CASH_ADVANCE_FOR_INVALID")
    })

    it("shows the balance as one number, with what of it is for a task or a client under it", async () => {
        await give("e1", 200)
        await give("e1", 100, { forClientId: "nile" })
        const mine = await advance("e1")
        expect(mine.balance).toBe(800)
        expect(mine.running).toBe(200)
        expect(mine.held).toEqual([
            { forTask: { id: "gate", title: "Fix the gate" }, forClient: null, amount: 500 },
            { forTask: null, forClient: { id: "nile", name: "Nile Foods" }, amount: 100 },
        ])
        // Their own, on My cash advance, the same.
        expect((await Advances.person(ehab.user, "e1", PAGE)).held).toHaveLength(2)
        // The Cash advances tab says how much of each balance is for tasks or clients.
        const row = (await Advances.list(admin.user, {}, PAGE)).data.find(p => p.id === "e1")!
        expect(row).toMatchObject({ balance: 800, earmarked: 600 })
        // Each entry says what it was for.
        expect(mine.data.find(e => e.amount === 100)).toMatchObject({ forClient: { id: "nile", name: "Nile Foods" } })
    })

    it("takes a return or a correction from the part it names, never below zero there", async () => {
        // The running balance is 200: more than that isn't on it, though 800 is held.
        expect(await refusal(Advances.record(admin, "e1", { kind: "RETURNED", amount: 250, date: "2026-10-02" }))).toBe("CASH_ADVANCE_MORE_THAN_HELD")
        expect(await refusal(Advances.record(admin, "e1", { kind: "RETURNED", amount: 501, date: "2026-10-02", forTaskId: "gate" }))).toBe("CASH_ADVANCE_MORE_THAN_HELD")
        await Advances.record(admin, "e1", { kind: "RETURNED", amount: 150, date: "2026-10-02", forTaskId: "gate" })
        expect(await refusal(Advances.record(admin, "e1", { kind: "CORRECTION", amount: -101, date: "2026-10-02", note: "Miscounted", forClientId: "nile" }))).toBe("CASH_ADVANCE_BELOW_ZERO")
        await Advances.record(admin, "e1", { kind: "CORRECTION", amount: -40, date: "2026-10-02", note: "Miscounted", forClientId: "nile" })
        // A part they hold nothing in isn't theirs to take from.
        expect(await refusal(Advances.record(admin, "e1", { kind: "RETURNED", amount: 10, date: "2026-10-02", forTaskId: "yard" }))).toBe("CASH_ADVANCE_FOR_INVALID")
        const after = await advance("e1")
        expect(after).toMatchObject({ balance: 610, running: 200 })
        expect(after.held.map(h => h.amount)).toEqual([350, 60])
    })

    const parts = async (userId: string) => (await advance(userId)).held.map(h => [h.forTask?.id ?? h.forClient?.id, h.amount])

    it("spends a cost from the money for its task first, then for its client, then the running balance (7f)", async () => {
        // Ehab holds 350 for the gate, 60 for Nile Foods, the gate's client, and 200 besides.
        await Tasks.submit("gate", "e1", ehab, { isDraft: true, costs: [{ amount: 300, description: "Hinges" }, { amount: 100, description: "Lock" }] })
        const costs = (await db.query(`SELECT description, amount::float, "fromAdvance"::float AS advance FROM "TaskCost" WHERE "taskId" = 'gate' ORDER BY amount DESC`)).rows
        expect(costs).toEqual([{ description: "Hinges", amount: 300, advance: 300 }, { description: "Lock", amount: 100, advance: 100 }])
        // Each part it took from is an entry of its own, on its cost.
        const spent = (await db.query(`SELECT c.description, e.amount::float, e."forTaskId", e."forClientId" FROM "CashAdvanceEntry" e JOIN "TaskCost" c ON c.id = e."costId" WHERE e.kind = 'SPENT' AND e."taskId" = 'gate' ORDER BY c.amount DESC, e."forTaskId" NULLS LAST`)).rows
        expect(spent).toEqual([
            { description: "Hinges", amount: -300, forTaskId: "gate", forClientId: null },
            { description: "Lock", amount: -50, forTaskId: "gate", forClientId: null },
            { description: "Lock", amount: -50, forTaskId: null, forClientId: "nile" },
        ])
        // The running balance untouched, while the gate's and Nile Foods' money paid.
        expect(await advance("e1")).toMatchObject({ balance: 210, running: 200 })
        expect(await parts("e1")).toEqual([["nile", 10]])
    })

    it("spends the client's money on any of its tasks, and none held for a task or a client on a cost elsewhere", async () => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "locationId", "updatedAt") VALUES ('dock', 'Fix the dock', 'd', 'IN_PROGRESS', now() + interval '3 days', 'c1', 'nile', 'port', now());
            INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('dock', 'e1')`)
        await give("e1", 40, { forClientId: "nile" })
        // Another of Nile Foods' tasks: from its money, 50.
        await Tasks.submit("dock", "e1", ehab, { isDraft: true, costs: [{ amount: 30, description: "Rope" }] })
        // A task with no client: the running balance only, though 20 is held for Nile Foods.
        await Tasks.submit("yard", "e1", ehab, { isDraft: true, costs: [{ amount: 50, description: "Bags" }] })
        expect(await advance("e1")).toMatchObject({ balance: 170, running: 150 })
        expect(await parts("e1")).toEqual([["nile", 20]])
    })

    it("puts a cost's money back on the parts it came from as it's removed", async () => {
        const lock = (await db.query(`SELECT id FROM "TaskCost" WHERE "taskId" = 'gate' AND description = 'Lock'`)).rows[0].id
        await Tasks.deleteItem("gate", ehab, { type: "COST", itemId: lock })
        // 50 back for the gate, and 50 for Nile Foods.
        expect(await parts("e1")).toEqual([["gate", 50], ["nile", 70]])
        expect(await advance("e1")).toMatchObject({ balance: 270, running: 150 })
        const back = (await db.query(`SELECT amount::float, "forTaskId", "forClientId" FROM "CashAdvanceEntry" WHERE kind = 'SPENT' AND "costId" IS NULL AND amount > 0 ORDER BY "forTaskId" NULLS LAST`)).rows
        expect(back).toEqual([{ amount: 50, forTaskId: "gate", forClientId: null }, { amount: 50, forTaskId: null, forClientId: "nile" }])
    })

    it("puts back what a deleted task's costs took, its own money then the running balance's, until 7g", async () => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "locationId", "updatedAt") VALUES ('shed', 'Paint the shed', 'd', 'IN_PROGRESS', now() + interval '9 days', 'c1', NULL, 'port', now());
            INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('shed', 'e1')`)
        await give("e1", 25, { forTaskId: "shed" })
        // 25 from the shed's money, 15 from the running balance.
        await Tasks.submit("shed", "e1", ehab, { isDraft: true, costs: [{ amount: 40, description: "Paint" }] })
        expect(await advance("e1")).toMatchObject({ balance: 255, running: 135 })
        await Tasks.delete("shed", admin)
        // Each back where it came from, and the shed's gone with its task: on the running balance, until 7g.
        expect(await advance("e1")).toMatchObject({ balance: 295, running: 175 })
        expect(await parts("e1")).toEqual([["gate", 50], ["nile", 70]])
    })

    it("puts back what a cost from before 7f took on the running balance, where it was taken from", async () => {
        // Its Spent entry names no part, as 7b wrote them.
        await db.query(`INSERT INTO "TaskCost"(id, "taskId", "authorId", "authorName", amount, description, "fromAdvance") VALUES ('old', 'gate', 'e1', 'Ehab One', 20, 'Old', 20);
            INSERT INTO "CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "recordedById", "costId", "taskId") VALUES ('old-spent', 'c1', 'e1', 'SPENT', -20, '2026-10-01', 'e1', 'old', 'gate')`)
        expect((await advance("e1")).running).toBe(155)
        await Tasks.deleteItem("gate", ehab, { type: "COST", itemId: "old" })
        expect((await advance("e1")).running).toBe(175)
        expect(await parts("e1")).toEqual([["gate", 50], ["nile", 70]])
    })

    it("moves each part to the running balance before what's held becomes a debt on leaving", async () => {
        // A company with no package has everything, Payroll too.
        await give("e3", 120, { forTaskId: "yard" })
        await give("e3", 30)
        const debt = await prisma.$transaction(tx => Advances.toDebt(tx, "c1", "e3", null, { dueDate: new Date(), by: { id: "a1", name: "Amal One" } }))
        expect(Number(debt?.amount)).toBe(150)
        const entries = (await db.query(`SELECT kind::text, amount::float, "forTaskId" FROM "CashAdvanceEntry" WHERE "userId" = 'e3' AND kind::text IN ('MOVED', 'DEBT') ORDER BY kind::text = 'DEBT', amount`)).rows
        expect(entries).toEqual([
            { kind: "MOVED", amount: -120, forTaskId: "yard" },
            { kind: "MOVED", amount: 120, forTaskId: null },
            { kind: "DEBT", amount: -150, forTaskId: null },
        ])
        expect(await advance("e3")).toMatchObject({ balance: 0, running: 0, held: [] })
    })

    it("offers what it can be for: the open tasks they're on, and the company's clients not archived", async () => {
        const offered = await Advances.purposes(admin.user, "e1")
        // Soonest due first, then by title.
        expect(offered.tasks).toEqual([{ id: "yard", title: "Clean the yard" }, { id: "gate", title: "Fix the gate" }, { id: "dock", title: "Fix the dock" }])
        expect(offered.clients).toEqual([{ id: "nile", name: "Nile Foods" }])
        // Only for whoever may give them an advance.
        expect(await Advances.purposes(ehab.user, "e2").then(() => "offered", (e: Error) => e.message)).toBe("CASH_ADVANCE_NOT_FOUND")
        expect(await Advances.purposes(ehab.user, "e1").then(() => "offered", (e: Error) => e.message)).toBe("CASH_ADVANCE_NOT_FOUND")
    })

    it("is refused by the database for a task and a client at once, or moved by nothing", async () => {
        const insert = (cols: string, vals: string) => db.query(`INSERT INTO "CashAdvanceEntry"(id, "companyId", "userId", kind, amount, date, "recordedById", ${cols}) VALUES (gen_random_uuid()::text, 'c1', 'e2', ${vals})`).then(() => "inserted", (e: Error) => e.message)
        expect(await insert(`"forTaskId", "forClientId"`, `'GIVEN', 10, '2026-10-01', 'a1', 'shelves', 'nile'`)).toMatch(/check/)
        expect(await insert(`"forTaskId"`, `'MOVED', 0, '2026-10-01', 'a1', 'shelves'`)).toMatch(/check/)
    })
})
