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
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let costs: typeof import("@/lib/services/costs-query")

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
})
