import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * A receipt photo for each cost (CLIENTS_PLAN.md §6.2, step 6a), against a
 * real Postgres: a cost keeps the receipt uploaded for it, only one uploaded
 * to its company's receipts folder and still stored, on it alone; the
 * receipt goes from storage with its cost, or its task; and the orphan
 * sweep counts it as in use.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co"
const BUCKET = "https://abc.supabase.co/storage/v1/object/public/app-assets/"

// The bucket: what's in it, and what was asked to go.
const storage = vi.hoisted(() => ({ stored: new Set<string>(), removed: [] as string[] }))
vi.mock("@/lib/storage", () => ({
    supabase: {
        storage: {
            from: () => ({
                exists: async (path: string) => ({ data: storage.stored.has(path), error: null }),
                remove: async (paths: string[]) => {
                    storage.removed.push(...paths)
                    paths.forEach(p => storage.stored.delete(p))
                    return { data: [], error: null }
                },
            }),
        },
    },
    uploadToCloud: async () => { throw new Error("no uploads here") },
}))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`
const TASKS = `
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "updatedAt") VALUES
 ('t1', 'Fix the door', 'It sticks', 'IN_PROGRESS', now() + interval '2 days', 'c1', now()),
 ('t2', 'Paint the gate', 'Green', 'IN_PROGRESS', now() + interval '2 days', 'c1', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('t1', 'e1'), ('t2', 'e1');
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any
const ehab = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" }) } as any
const superAdmin = { user: withGrants({ id: "sa1", role: "SUPER_ADMIN", companyId: null, name: "Sami Admin" }) } as any

describe.skipIf(!ADMIN_URL)("costs' receipts, in Postgres", () => {
    const dbName = `cost_receipts_test_${Date.now()}`
    let db: Client
    let Tasks: typeof import("@/lib/services/task.service").TaskService

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
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    beforeEach(() => { storage.removed.length = 0 })

    /** A file uploaded and in the bucket, at this path. */
    const uploaded = (path: string) => { storage.stored.add(path); return BUCKET + path }
    const receipts = async (taskId: string) => (await db.query(`SELECT description, "receiptUrl" FROM "TaskCost" WHERE "taskId" = $1 ORDER BY description`, [taskId])).rows
    const add = (session: any, costs: object[], taskId = "t1") => Tasks.submit(taskId, session.user.id, session, { isDraft: true, costs })

    it("keeps the receipt taken for a cost, and none for a cost without one", async () => {
        const photo = uploaded("c1/receipts/1-taxi.jpg")
        await add(ehab, [{ amount: 50, description: "Taxi", receiptUrl: photo }, { amount: 20, description: "Bus" }])
        expect(await receipts("t1")).toEqual([
            { description: "Bus", receiptUrl: null },
            { description: "Taxi", receiptUrl: photo },
        ])
    })

    it("refuses one that isn't a photo uploaded here for this company's costs, and saves nothing", async () => {
        const before = await receipts("t1")
        const taken = (await receipts("t1")).find(r => r.receiptUrl)!.receiptUrl
        const twice = uploaded("c1/receipts/2-twice.jpg")
        for (const costs of [
            [{ amount: 5, receiptUrl: uploaded("c2/receipts/3-theirs.jpg") }],   // another company's
            [{ amount: 5, receiptUrl: uploaded("c1/records/4-record.pdf") }],    // one of the company's other files
            [{ amount: 5, receiptUrl: "https://elsewhere.example/5.jpg" }],      // a link to anywhere else
            [{ amount: 5, receiptUrl: uploaded("platform/receipts/6-sa.jpg") }], // a Super Admin's, sent by an employee
            [{ amount: 5, receiptUrl: BUCKET + "c1/receipts/7-gone.jpg" }],      // one no longer stored
            [{ amount: 5, receiptUrl: twice }, { amount: 6, receiptUrl: twice }], // one for two costs
            [{ amount: 5, receiptUrl: taken }],                                  // one on another cost already
            [{ amount: 5, receiptUrl: 42 }],                                     // not an address at all
        ]) {
            await expect(add(ehab, costs), JSON.stringify(costs)).rejects.toMatchObject({ message: "COST_RECEIPT_INVALID" })
        }
        expect(await receipts("t1")).toEqual(before)
    })

    it("takes a Super Admin's own receipt", async () => {
        const photo = uploaded("platform/receipts/8-sa.jpg")
        await add(superAdmin, [{ amount: 15, description: "Parking", receiptUrl: photo }])
        expect((await receipts("t1")).find(r => r.description === "Parking")).toEqual({ description: "Parking", receiptUrl: photo })
    })

    it("removes a cost's receipt from storage with the cost, and no other file", async () => {
        const taxi = (await db.query(`SELECT id FROM "TaskCost" WHERE description = 'Taxi'`)).rows[0].id
        await Tasks.deleteItem("t1", ehab, { type: "COST", itemId: taxi })
        expect(storage.removed).toEqual(["c1/receipts/1-taxi.jpg"])
        expect((await receipts("t1")).map(r => r.description)).not.toContain("Taxi")
        // One with no receipt takes nothing with it.
        const bus = (await db.query(`SELECT id FROM "TaskCost" WHERE description = 'Bus'`)).rows[0].id
        await Tasks.deleteItem("t1", ehab, { type: "COST", itemId: bus })
        expect(storage.removed).toEqual(["c1/receipts/1-taxi.jpg"])
    })

    it("removes a task's receipts from storage with the task", async () => {
        await add(ehab, [{ amount: 300, description: "Paint", receiptUrl: uploaded("c1/receipts/9-paint.jpg") }], "t2")
        await Tasks.delete("t2", admin)
        expect(storage.removed).toEqual(["c1/receipts/9-paint.jpg"])
    })

    it("is counted in use by the orphan sweep", async () => {
        const { MaintenanceService } = await import("@/lib/services/maintenance.service")
        const inUse = await MaintenanceService.collectReferencedPaths()
        expect(inUse.has("platform/receipts/8-sa.jpg")).toBe(true)
        expect(inUse.has("c1/receipts/1-taxi.jpg")).toBe(false)
    })
})
