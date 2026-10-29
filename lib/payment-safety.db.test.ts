import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Payment safety (CLIENTS_PLAN.md §4.1, §4.2), against a real Postgres: Mark
 * all as paid pays exactly the costs confirmed, holding the tasks while it
 * checks them again, and a task whose costs are paid, in full or in part,
 * can't be deleted.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`
// Waiting to be paid; paid in full; paid in part.
const TASKS = `
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "totalCost", "paymentStatus", "memberCosts", "memberPaymentStatus", "updatedAt") VALUES
 ('due', 'Due', 'Waiting to be paid', 'APPROVED', now(), 'c1', 100, 'PENDING_PAYMENT', '{"e1": 100}', '{"e1": "PENDING_PAYMENT"}', now()),
 ('paid', 'Paid', 'Paid in full', 'COMPLETED', now(), 'c1', 50, 'PAID', '{"e1": 50}', '{"e1": "PAID"}', now()),
 ('part', 'Part', 'Paid in part', 'APPROVED', now(), 'c1', 50, 'PENDING_PAYMENT', '{"e1": 30, "e2": 20}', '{"e1": "PAID"}', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('due', 'e1'), ('paid', 'e1'), ('part', 'e1'), ('part', 'e2');
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any

describe.skipIf(!ADMIN_URL)("payment safety, in Postgres", () => {
    const dbName = `payment_safety_test_${Date.now()}`
    let db: Client
    let dbUrl: string
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let costs: typeof import("@/lib/services/costs-query")

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
        await db.query(TASKS)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Tasks = (await import("@/lib/services/task.service")).TaskService
        costs = await import("@/lib/services/costs-query")
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    const shown = async () => costs.pendingCostsSnapshot((await costs.pendingCostsWhere(admin.user, {}))!)
    const status = async () => (await db.query(`SELECT id, "paymentStatus" FROM "Task" ORDER BY id`)).rows.map(r => `${r.id}:${r.paymentStatus}`)

    it("won't delete a task whose costs are paid, in full or in part", async () => {
        await expect(Tasks.delete("paid", admin)).rejects.toMatchObject({ message: "TASK_HAS_PAID_COSTS" })
        await expect(Tasks.delete("part", admin)).rejects.toMatchObject({ message: "TASK_HAS_PAID_COSTS" })
        expect((await db.query(`SELECT count(*)::int AS n FROM "Task"`)).rows[0].n).toBe(3)
    })

    it("shows what's due: each part not yet paid", async () => {
        const list = await shown()
        expect({ count: list.count, amount: list.amount, taskIds: list.taskIds.sort() }).toEqual({ count: 2, amount: 120, taskIds: ["due", "part"] })
    })

    it("pays nothing when a cost changed after the list was shown", async () => {
        const list = await shown()
        await db.query(`UPDATE "Task" SET "memberCosts" = '{"e1": 100, "e2": 5}' WHERE id = 'due'`)
        try {
            await expect(Tasks.bulkUpdatePayment(list.taskIds, admin, undefined, list.digest)).rejects.toMatchObject({ message: "PAYMENT_LIST_CHANGED" })
            expect(await status()).toEqual(["due:PENDING_PAYMENT", "paid:PAID", "part:PENDING_PAYMENT"])
        } finally {
            await db.query(`UPDATE "Task" SET "memberCosts" = '{"e1": 100}' WHERE id = 'due'`)
        }
    })

    it("pays exactly what was confirmed, and not twice", async () => {
        const list = await shown()
        expect(await Tasks.bulkUpdatePayment(list.taskIds, admin, undefined, list.digest)).toEqual({ count: 2 })
        expect(await status()).toEqual(["due:PAID", "paid:PAID", "part:PAID"])
        await expect(Tasks.bulkUpdatePayment(list.taskIds, admin, undefined, list.digest)).rejects.toMatchObject({ message: "PAYMENT_LIST_CHANGED" })
    })

    it("then won't delete those either", async () => {
        await expect(Tasks.delete("due", admin)).rejects.toMatchObject({ message: "TASK_HAS_PAID_COSTS" })
    })

    it("won't delete one paid in part whose shares' payments are stored as text, as the task's page reads them", async () => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "totalCost", "paymentStatus", "memberCosts", "memberPaymentStatus", "updatedAt")
            VALUES ('text', 'Text', 'Paid in part, stored as text', 'APPROVED', now(), 'c1', 50, 'PENDING_PAYMENT', '{"e1": 30, "e2": 20}', to_jsonb('{"e1": "PAID", "e2": "PENDING_PAYMENT"}'::text), now())`)
        await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('text', 'e1'), ('text', 'e2')`)
        await expect(Tasks.delete("text", admin)).rejects.toMatchObject({ message: "TASK_HAS_PAID_COSTS" })
        expect((await db.query(`SELECT count(*)::int AS n FROM "Task" WHERE id = 'text'`)).rows[0].n).toBe(1)
    })

    it("won't delete a task paid while the delete waits for it", async () => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "totalCost", "paymentStatus", "memberCosts", "memberPaymentStatus", "updatedAt")
            VALUES ('racing', 'Racing', 'Paid as it is deleted', 'APPROVED', now(), 'c1', 40, 'PENDING_PAYMENT', '{"e1": 40}', '{"e1": "PENDING_PAYMENT"}', now())`)
        await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('racing', 'e1')`)
        // A payment holds the task, not yet committed, as paying one does.
        const payer = new Client({ connectionString: dbUrl })
        await payer.connect()
        try {
            await payer.query("BEGIN")
            await payer.query(`UPDATE "Task" SET "paymentStatus" = 'PAID', status = 'COMPLETED', "memberPaymentStatus" = '{"e1": "PAID"}' WHERE id = 'racing'`)
            const deleting = Tasks.delete("racing", admin).then(() => "deleted", e => e.message)
            // The delete is waiting on the payment's hold before it commits.
            for (let i = 0; i < 200; i++) {
                const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
                if (rows[0].n > 0) break
                await new Promise(r => setTimeout(r, 50))
            }
            await payer.query("COMMIT")
            expect(await deleting).toBe("TASK_HAS_PAID_COSTS")
            expect((await db.query(`SELECT "paymentStatus" FROM "Task" WHERE id = 'racing'`)).rows).toEqual([{ paymentStatus: "PAID" }])
        } finally {
            await payer.end()
        }
    })
})
