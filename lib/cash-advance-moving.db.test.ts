import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * What's left of an advance for a task or a client (CLIENTS_PLAN.md §7.9,
 * step 7g), against a real Postgres: it moves to the running balance as the
 * task is approved or deleted, or the client archived or deleted, and by
 * hand for whoever may give and settle advances. A rejected task keeps it.
 * Each move is a pair of Moved entries, and the balance stays what it was.
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
 ('e4', 'e4@x', 'p', 'Fady', 'One', 'EMPLOYEE', 2026, 'e4', 'c1', NULL),
 ('e5', 'e5@x', 'p', 'Hoda', 'One', 'EMPLOYEE', 2026, 'e5', 'c1', NULL);
`
// Nile Foods has tasks; Dune and Reed have none. Ehab and Essam are on the
// gate, Ehab alone on the roof and the dock, Eman on the shed. Fady is on the
// mast and the keel, Hoda on the hull and Kelp's pier.
const WORK = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('nile', 'c1', 'Nile Foods', 'o', '0100', 'HQ', now()),
 ('dune', 'c1', 'Dune', 'o', '0101', 'HQ', now()),
 ('reed', 'c1', 'Reed', 'o', '0102', 'HQ', now()),
 ('kelp', 'c1', 'Kelp', 'o', '0103', 'HQ', now()),
 ('sand', 'c1', 'Sand', 'o', '0104', 'HQ', now()),
 ('moss', 'c1', 'Moss', 'o', '0105', 'HQ', now());
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "locationId", "updatedAt") VALUES
 ('gate', 'Fix the gate', 'd', 'PENDING_CONFIRMATION', now() + interval '2 days', 'c1', 'nile', 'port', now()),
 ('roof', 'Patch the roof', 'd', 'PENDING_CONFIRMATION', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('dock', 'Sweep the dock', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('shed', 'Paint the shed', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('mast', 'Raise the mast', 'd', 'PENDING_CONFIRMATION', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('keel', 'Scrape the keel', 'd', 'PENDING_CONFIRMATION', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('hull', 'Seal the hull', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('pier', 'Mend the pier', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'kelp', 'port', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('gate', 'e1'), ('gate', 'e3'), ('roof', 'e1'), ('dock', 'e1'), ('shed', 'e2'),
 ('mast', 'e4'), ('keel', 'e4'), ('hull', 'e5'), ('pier', 'e5');
`

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" })
const ehab = as({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" })
const hoda = as({ id: "e5", role: "EMPLOYEE", companyId: "c1", name: "Hoda One" })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const PAGE = { page: 1, limit: 50, skip: 0 }

describe.skipIf(!ADMIN_URL)("what's left of an advance for a task or a client, in Postgres", () => {
    const dbName = `advance_moving_test_${Date.now()}`
    let db: Client
    let dbUrl: string
    let Advances: typeof import("@/lib/services/cash-advance.service").CashAdvanceService
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let Clients: typeof import("@/lib/services/client.service").ClientService
    let prisma: typeof import("@/lib/prisma").prisma

    const give = (userId: string, amount: number, more: Record<string, unknown> = {}) =>
        Advances.record(admin, userId, { kind: "GIVEN", amount, date: "2026-10-01", ...more })
    const refusal = (p: Promise<unknown>) => p.then(() => "moved", (e: Error) => e.message)
    const advance = (userId: string) => Advances.person(admin.user, userId, PAGE)
    const held = async (userId: string) => (await advance(userId)).held.map(h => [h.forTask?.id ?? h.forClient?.id, h.amount])
    // Another connection, as another request would be.
    const connect = async () => { const c = new Client({ connectionString: dbUrl }); await c.connect(); return c }
    // Whether a person's advance is free to hold: nothing is waiting with it held.
    const personFree = async (userId: string) => {
        const c = await connect()
        try {
            await c.query("BEGIN")
            const { rows } = await c.query(`SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok`, [`cash-advance:${userId}`])
            await c.query("ROLLBACK")
            return rows[0].ok as boolean
        } finally { await c.end() }
    }
    const moved = async (userId: string) =>
        (await db.query(`SELECT amount::float, "forTaskId", "forClientId", "recordedByName" FROM "CashAdvanceEntry" WHERE "userId" = $1 AND kind::text = 'MOVED' ORDER BY "createdAt", amount`, [userId])).rows

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        dbUrl = url.toString()
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(WORK)
        await db.query(`UPDATE "Company" SET "cashAdvancesAllowed" = true WHERE id = 'c1'`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Advances = (await import("@/lib/services/cash-advance.service")).CashAdvanceService
        Tasks = (await import("@/lib/services/task.service")).TaskService
        Clients = (await import("@/lib/services/client.service")).ClientService
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

    it("moves what everyone holds for a task to their running balance as it's approved", async () => {
        await give("e1", 500, { forTaskId: "gate" })
        await give("e1", 300)
        await give("e3", 200, { forTaskId: "gate" })
        await give("e1", 100, { forTaskId: "roof" })

        // No costs, so approved is completed: the same to its money.
        await Tasks.review("gate", admin, { status: "APPROVED" })
        expect(await held("e1")).toEqual([["roof", 100]])
        expect(await held("e3")).toEqual([])
        const e1 = await advance("e1")
        expect([e1.balance, e1.running]).toEqual([900, 800])
        expect((await advance("e3")).running).toBe(200)
        // A pair each, by whoever approved it: taken from the task, added to the running balance.
        expect(await moved("e1")).toEqual([
            { amount: -500, forTaskId: "gate", forClientId: null, recordedByName: "Amal One" },
            { amount: 500, forTaskId: null, forClientId: null, recordedByName: "Amal One" },
        ])
        expect(await moved("e3")).toEqual([
            { amount: -200, forTaskId: "gate", forClientId: null, recordedByName: "Amal One" },
            { amount: 200, forTaskId: null, forClientId: null, recordedByName: "Amal One" },
        ])
    })

    it("leaves a rejected task its money, as it can be handed in again", async () => {
        await Tasks.review("roof", admin, { status: "REJECTED" })
        expect(await held("e1")).toEqual([["roof", 100]])
        expect((await moved("e1")).length).toBe(2)
        // Approved later, it moves then.
        await Tasks.review("roof", admin, { status: "APPROVED" })
        expect(await held("e1")).toEqual([])
        expect((await advance("e1")).running).toBe(900)
    })

    it("moves what's held for a task as it's deleted, and says the task it was for is gone", async () => {
        await give("e1", 150, { forTaskId: "dock" })
        await Tasks.delete("dock", admin)
        expect(await held("e1")).toEqual([])
        const e1 = await advance("e1")
        expect([e1.balance, e1.running]).toEqual([1050, 1050])
        // Taken from a part that's gone: the history says so.
        const taken = e1.data.find(e => e.kind === "MOVED" && e.amount === -150)
        expect(taken).toMatchObject({ forTask: null, forClient: null, partGone: true })
        expect(e1.data.find(e => e.kind === "MOVED" && e.amount === 150)).toMatchObject({ partGone: false })
        expect(e1.data.find(e => e.kind === "MOVED" && e.amount === -500)).toMatchObject({ forTask: { id: "gate" }, partGone: false })
    })

    it("moves what's held for a client as it's archived or deleted", async () => {
        await give("e2", 250, { forClientId: "nile" })
        await give("e3", 50, { forClientId: "dune" })
        // Nile Foods has tasks: it's archived.
        expect(await Clients.delete("nile", admin)).toMatchObject({ archived: true })
        expect(await held("e2")).toEqual([])
        expect((await advance("e2")).running).toBe(250)
        expect(await moved("e2")).toEqual([
            { amount: -250, forTaskId: null, forClientId: "nile", recordedByName: "Amal One" },
            { amount: 250, forTaskId: null, forClientId: null, recordedByName: "Amal One" },
        ])
        // Restored, nothing comes back.
        await Clients.restore("nile", admin)
        expect(await held("e2")).toEqual([])
        // Dune has none: it's deleted for good.
        expect(await Clients.delete("dune", admin)).toMatchObject({ archived: false })
        expect(await held("e3")).toEqual([])
        expect((await advance("e3")).running).toBe(250)
    })

    it("moves a task's or a client's money by hand, for whoever may give and settle advances", async () => {
        await give("e2", 300, { forTaskId: "shed" })
        await give("e2", 120, { forClientId: "reed" })
        expect(await refusal(Advances.move(ehab, "e2", { forTaskId: "shed" }))).toBe("CASH_ADVANCE_NOT_FOUND")
        expect(await refusal(Advances.move(admin, "e2", {}))).toBe("CASH_ADVANCE_FOR_INVALID")
        expect(await refusal(Advances.move(admin, "e2", { forTaskId: "shed", forClientId: "reed" }))).toBe("CASH_ADVANCE_FOR_INVALID")
        expect(await refusal(Advances.move(admin, "e2", { forTaskId: "gate" }))).toBe("CASH_ADVANCE_NOTHING_HELD")

        expect(await Advances.move(admin, "e2", { forTaskId: "shed" })).toMatchObject({ moved: 300, balance: 670 })
        expect(await held("e2")).toEqual([["reed", 120]])
        expect(await Advances.move(admin, "e2", { forClientId: "reed" })).toMatchObject({ moved: 120, balance: 670 })
        expect(await held("e2")).toEqual([])
        expect((await advance("e2")).running).toBe(670)
        expect(await refusal(Advances.move(admin, "e2", { forClientId: "reed" }))).toBe("CASH_ADVANCE_NOTHING_HELD")

        const audit = (await db.query(`SELECT details FROM "AuditLog" WHERE action = 'MOVE_CASH_ADVANCE' AND "entityId" = 'e2' AND details->>'because' = 'BY_HAND' ORDER BY "createdAt"`)).rows
        expect(audit.map(r => r.details)).toEqual([
            expect.objectContaining({ amount: 300, forTaskId: "shed", because: "BY_HAND" }),
            expect.objectContaining({ amount: 120, forClientId: "reed", because: "BY_HAND" }),
        ])
    })

    it("asks for two-factor sign-in to move by hand", async () => {
        await give("e2", 40, { forTaskId: "shed" })
        const stale = { user: { ...admin.user, stepUpAt: 0 } } as any
        expect(await refusal(Advances.move(stale, "e2", { forTaskId: "shed" }))).toMatch(/STEP_UP/)
        expect(await held("e2")).toEqual([["shed", 40]])
    })

    it("logs each automatic move, saying why", async () => {
        const audit = (await db.query(`SELECT "entityId", details FROM "AuditLog" WHERE action = 'MOVE_CASH_ADVANCE' AND details->>'because' <> 'BY_HAND' ORDER BY "createdAt", "entityId"`)).rows
        expect(audit.map(r => [r.entityId, r.details.because, r.details.amount])).toEqual([
            ["e1", "TASK_APPROVED", 500], ["e3", "TASK_APPROVED", 200],
            ["e1", "TASK_APPROVED", 100],
            ["e1", "TASK_DELETED", 150],
            ["e2", "CLIENT_ARCHIVED", 250],
            ["e3", "CLIENT_DELETED", 50],
        ])
    })

    it("moves a rejected task's money when paying it completes it", async () => {
        await give("e4", 120, { forTaskId: "mast" })
        await Tasks.review("mast", admin, { status: "REJECTED" })
        expect(await held("e4")).toEqual([["mast", 120]])
        await Tasks.updatePayment("mast", admin, { paymentStatus: "PAID" })
        expect(await held("e4")).toEqual([])
        expect((await advance("e4")).running).toBe(120)
    })

    it("moves it as Mark all as paid completes a rejected task", async () => {
        await give("e4", 80, { forTaskId: "keel" })
        await Tasks.review("keel", admin, { status: "REJECTED" })
        await Tasks.bulkUpdatePayment(["keel"], admin)
        expect(await held("e4")).toEqual([])
        expect((await advance("e4")).running).toBe(200)
        const because = (await db.query(`SELECT details->>'because' AS b FROM "AuditLog" WHERE action = 'MOVE_CASH_ADVANCE' AND "entityId" = 'e4' ORDER BY "createdAt"`)).rows.map(r => r.b)
        expect(because).toEqual(["TASK_PAID", "TASK_PAID"])
    })

    it("refuses an advance given for a task while its approval commits", async () => {
        const approval = await connect()
        await approval.query("BEGIN")
        await approval.query(`UPDATE "Task" SET status = 'APPROVED' WHERE id = 'hull'`)
        const giving = refusal(give("e5", 60, { forTaskId: "hull" }))
        await sleep(500)
        await approval.query("COMMIT")
        await approval.end()
        expect(await giving).toBe("CASH_ADVANCE_TASK_DONE")
        expect(await held("e5")).toEqual([])
    })

    it("refuses an advance given for a client while it's archived, holding the client before the person", async () => {
        const archiving = await connect()
        await archiving.query("BEGIN")
        await archiving.query(`SELECT id FROM "Client" WHERE id = 'sand' FOR UPDATE`)
        const giving = refusal(give("e5", 70, { forClientId: "sand" }))
        await sleep(500)
        // Waiting for the client, not holding Hoda's advance: the archive can take it.
        expect(await personFree("e5")).toBe(true)
        await archiving.query(`UPDATE "Client" SET "archivedAt" = now() WHERE id = 'sand'`)
        await archiving.query("COMMIT")
        await archiving.end()
        expect(await giving).toBe("CASH_ADVANCE_CLIENT_ARCHIVED")
        expect(await held("e5")).toEqual([])
    })

    it("moves by hand only once it holds the client, so a move and an archive can't wait on each other", async () => {
        await give("e5", 90, { forClientId: "moss" })
        const archiving = await connect()
        await archiving.query("BEGIN")
        await archiving.query(`SELECT id FROM "Client" WHERE id = 'moss' FOR UPDATE`)
        const moving = refusal(Advances.move(admin, "e5", { forClientId: "moss" }))
        await sleep(500)
        expect(await personFree("e5")).toBe(true)
        await archiving.query("ROLLBACK")
        await archiving.end()
        expect(await moving).toBe("moved")
        expect(await held("e5")).toEqual([])
        expect((await advance("e5")).running).toBe(90)
    })

    it("puts back a removed cost's money on the running balance where its client has been archived", async () => {
        await give("e5", 100, { forClientId: "kelp" })
        await Tasks.submit("pier", "e5", hoda, { isDraft: true, costs: [{ amount: 40, description: "Rope" }] })
        expect(await held("e5")).toEqual([["kelp", 60]])
        // Kelp has a task: it's archived, and its 60 moves.
        expect(await Clients.delete("kelp", admin)).toMatchObject({ archived: true })
        expect(await held("e5")).toEqual([])
        const [cost] = (await db.query(`SELECT id FROM "TaskCost" WHERE "taskId" = 'pier'`)).rows
        await Tasks.deleteItem("pier", hoda, { type: "COST", itemId: cost.id })
        // The 40 goes back where it came from, and on to the running balance.
        expect(await held("e5")).toEqual([])
        expect((await advance("e5")).running).toBe(190)
    })
})
