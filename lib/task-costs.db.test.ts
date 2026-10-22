import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { costLines } from "@/lib/task-costs"

/**
 * Costs in their own table, with their descriptions (CLIENTS_PLAN.md §4.4,
 * §4.5), against a real Postgres: the migration gives every cost entry from
 * before a row, and TaskService adds costs with their descriptions and
 * removes them one at a time, by id.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const TASK_COSTS = "20261113000000_task_costs"
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`

const AT = "2026-10-20T09:30:00.000Z"
const cost = (amount: unknown, by = "e1", date = AT) => ({ type: "COST_ADDITION", text: "Added cost", amount, author: by === "e1" ? "Ehab One" : "Eman One", authorId: by, date })
// Costs from before their table: two added together, so at the same time,
// among a note and a location; and entries that were never costs.
const BEFORE = [
    { type: "SUBMISSION_NOTE", text: "Started", author: "Ehab One", authorId: "e1", date: "2026-10-20T09:00:00.000Z" },
    cost(150),
    cost(40.5),
    { type: "LOCATION_ADDED", text: "Location: here", authorId: "e1", date: AT },
    cost(0),
    cost("12"),
    cost(25, "e2", "2026-10-21T08:00:00.000Z"),
]
const TASKS_BEFORE = `
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", comments, "memberCosts", "totalCost", "updatedAt") VALUES
 ('t-old', 'Fix the door', 'It sticks', 'IN_PROGRESS', now() + interval '2 days', 'c1', '${JSON.stringify(BEFORE)}', '{"e1": 190.5, "e2": 25}', 215.5, now()),
 ('t-odd', 'Odd', 'Comments not a list', 'IN_PROGRESS', now() + interval '2 days', 'c1', '{"type": "COST_ADDITION", "amount": 5}', NULL, 0, now()),
 ('t-none', 'None', 'No comments', 'IN_PROGRESS', now() + interval '2 days', 'c1', NULL, NULL, 0, now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('t-old', 'e1'), ('t-old', 'e2');
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any
const ehab = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" }) } as any
const eman = { user: withGrants({ id: "e2", role: "EMPLOYEE", companyId: "c1", name: "Eman One" }) } as any

describe.skipIf(!ADMIN_URL)("task costs, in Postgres", () => {
    const dbName = `task_costs_test_${Date.now()}`
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
            if (m === TASK_COSTS) await db.query(TASKS_BEFORE)
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
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

    const taskRow = async (id: string) => (await db.query(`SELECT comments, "memberCosts", "totalCost"::float AS "totalCost" FROM "Task" WHERE id = $1`, [id])).rows[0]
    const costRows = async (taskId: string) => (await db.query(`SELECT id, "authorId", "authorName", amount::float AS amount, description, "createdAt" FROM "TaskCost" WHERE "taskId" = $1 ORDER BY "createdAt", amount DESC`, [taskId])).rows
    const listed = async (taskId: string) => costLines((await taskRow(taskId)).comments, await costRows(taskId))
    /** A task of Ehab's and Eman's, with nothing on it yet. */
    const fresh = async (id: string) => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "updatedAt") VALUES ($1, 'Paint', 'The hall', 'IN_PROGRESS', now() + interval '2 days', 'c1', now())`, [id])
        await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ($1, 'e1'), ($1, 'e2')`, [id])
        return id
    }

    describe("the migration", () => {
        it("gives each cost from before a row, which its entry names, as it was added, with no description", async () => {
            const { comments } = await taskRow("t-old")
            const rows = await costRows("t-old")
            expect(rows.map(r => ({ ...r, id: undefined }))).toEqual([
                { id: undefined, authorId: "e1", authorName: "Ehab One", amount: 150, description: null, createdAt: new Date(AT) },
                { id: undefined, authorId: "e1", authorName: "Ehab One", amount: 40.5, description: null, createdAt: new Date(AT) },
                { id: undefined, authorId: "e2", authorName: "Eman One", amount: 25, description: null, createdAt: new Date("2026-10-21T08:00:00.000Z") },
            ])
            expect(comments.filter((c: any) => c.costId).map((c: any) => [c.costId, c.amount])).toEqual(rows.map(r => [r.id, r.amount]))
        })

        it("leaves the rest as it was, in order: what isn't a cost, and comments that aren't a list", async () => {
            const { comments } = await taskRow("t-old")
            expect(comments.map((c: any) => Object.fromEntries(Object.entries(c).filter(([key]) => key !== "costId")))).toEqual(BEFORE)
            expect((await taskRow("t-odd")).comments).toEqual({ type: "COST_ADDITION", amount: 5 })
            expect((await taskRow("t-none")).comments).toBeNull()
            expect(await costRows("t-odd")).toEqual([])
        })

        it("holds what the schema can't say: a cost is more than nothing, its description at most 200 characters", async () => {
            const add = (amount: number, description: string | null) => db.query(`INSERT INTO "TaskCost"(id, "taskId", amount, description) VALUES (gen_random_uuid()::text, 't-none', $1, $2)`, [amount, description])
            await expect(add(0, null)).rejects.toThrow(/TaskCost_amount_positive/)
            await expect(add(0.004, null)).rejects.toThrow(/TaskCost_amount_positive/)
            await expect(add(5, "x".repeat(201))).rejects.toThrow(/TaskCost_description_length/)
        })

        it("leaves Row Level Security on, as on every table", async () => {
            expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'TaskCost'`)).rows).toEqual([{ relrowsecurity: true }])
        })
    })

    describe("adding costs", () => {
        it("keeps each one's description, trimmed, in its row and in its entry for the release before", async () => {
            const id = await fresh("t-add")
            await Tasks.submit(id, "e1", ehab, { isDraft: true, costs: [{ amount: 150, description: "  Taxi " }, { amount: 40.5, description: "" }, { amount: 0, description: "Nothing" }] })
            expect((await listed(id)).map(c => [c.amount, c.description, c.author])).toEqual([[150, "Taxi", "Ehab One"], [40.5, null, "Ehab One"]])
            const { comments, memberCosts, totalCost } = await taskRow(id)
            expect(comments.map((c: any) => c.description)).toEqual(["Taxi", undefined])
            expect(memberCosts).toEqual({ e1: 190.5 })
            expect(totalCost).toBe(190.5)
        })

        it("keeps amounts to the cent", async () => {
            const id = await fresh("t-cents")
            await Tasks.submit(id, "e1", ehab, { isDraft: true, costs: [{ amount: 12.345, description: "Tea" }, { amount: 0.004, description: "Rounds to nothing" }] })
            expect((await costRows(id)).map(r => r.amount)).toEqual([12.35])
            const { comments, memberCosts, totalCost } = await taskRow(id)
            expect(comments.map((c: any) => c.amount)).toEqual([12.35])
            expect([memberCosts, totalCost]).toEqual([{ e1: 12.35 }, 12.35])
        })

        it("refuses a description over 200 characters, and saves nothing", async () => {
            const id = await fresh("t-long")
            await expect(Tasks.submit(id, "e1", ehab, { isDraft: true, note: "Here", costs: [{ amount: 5, description: "x".repeat(201) }] })).rejects.toMatchObject({ message: "COST_DESCRIPTION_TOO_LONG" })
            expect(await taskRow(id)).toEqual({ comments: null, memberCosts: null, totalCost: 0 })
            expect(await costRows(id)).toEqual([])
        })

        it("keeps both people's costs when they save at once", async () => {
            const id = await fresh("t-both")
            await Promise.all([
                Tasks.submit(id, "e1", ehab, { isDraft: true, costs: [{ amount: 10, description: "Ehab's" }] }),
                Tasks.submit(id, "e2", eman, { isDraft: true, costs: [{ amount: 20, description: "Eman's" }] }),
            ])
            expect((await listed(id)).map(c => c.description).sort()).toEqual(["Eman's", "Ehab's"].sort())
            expect((await taskRow(id)).memberCosts).toEqual({ e1: 10, e2: 20 })
        })
    })

    describe("removing a cost", () => {
        it("removes it by its id, and only it, though another was added with it", async () => {
            const id = await fresh("t-remove")
            await Tasks.submit(id, "e1", ehab, { isDraft: true, costs: [{ amount: 150, description: "Taxi" }, { amount: 40.5, description: "Parking" }] })
            const [taxi] = await listed(id)
            await Tasks.deleteItem(id, ehab, { type: "COST", itemId: taxi.id })
            expect((await listed(id)).map(c => c.description)).toEqual(["Parking"])
            expect((await costRows(id)).map(r => r.description)).toEqual(["Parking"])
            const { memberCosts, totalCost } = await taskRow(id)
            expect([memberCosts, totalCost]).toEqual([{ e1: 40.5 }, 40.5])
        })

        it("from a page from before, by when it was added: only one of those added together, and its row", async () => {
            const id = await fresh("t-legacy")
            await Tasks.submit(id, "e1", ehab, { isDraft: true, costs: [{ amount: 150, description: "Taxi" }, { amount: 40.5, description: "Parking" }] })
            const [taxi] = await listed(id)
            await Tasks.deleteItem(id, ehab, { type: "COST_ADDITION", itemId: taxi.date })
            expect((await listed(id)).map(c => c.description)).toEqual(["Parking"])
            expect((await costRows(id)).map(r => r.description)).toEqual(["Parking"])
            expect((await taskRow(id)).totalCost).toBe(40.5)
        })

        it("removes nothing when it isn't said which", async () => {
            const id = await fresh("t-which")
            await Tasks.submit(id, "e1", ehab, { isDraft: true, costs: [{ amount: 150, description: "Taxi" }, { amount: 40.5, description: "Parking" }] })
            for (const type of ["COST", "COST_ADDITION"]) {
                await expect(Tasks.deleteItem(id, ehab, { type })).rejects.toMatchObject({ message: "ITEM_NOT_FOUND" })
            }
            expect((await listed(id)).map(c => c.description)).toEqual(["Taxi", "Parking"])
            expect((await taskRow(id)).totalCost).toBe(190.5)
        })

        it("removes one the release before added, with no row, by when it was added", async () => {
            const id = await fresh("t-meanwhile")
            await db.query(`UPDATE "Task" SET comments = $2, "memberCosts" = '{"e1": 75}', "totalCost" = 75 WHERE id = $1`, [id, JSON.stringify([cost(75)])])
            expect((await listed(id)).map(c => [c.id, c.amount])).toEqual([[null, 75]])
            await Tasks.deleteItem(id, ehab, { type: "COST_ADDITION", itemId: AT })
            expect(await listed(id)).toEqual([])
            expect((await taskRow(id)).totalCost).toBe(0)
        })

        it("isn't for someone else's cost, unless they may edit tasks", async () => {
            const id = await fresh("t-theirs")
            await Tasks.submit(id, "e1", ehab, { isDraft: true, costs: [{ amount: 30, description: "Ehab's" }] })
            const [mine] = await listed(id)
            await expect(Tasks.deleteItem(id, eman, { type: "COST", itemId: mine.id })).rejects.toMatchObject({ message: "UNAUTHORIZED_ITEM_DELETE" })
            await Tasks.deleteItem(id, admin, { type: "COST", itemId: mine.id })
            expect(await listed(id)).toEqual([])
        })

        it("is refused once its person's costs on the task are paid", async () => {
            const id = await fresh("t-paid")
            await Tasks.submit(id, "e1", ehab, { isDraft: true, costs: [{ amount: 30, description: "Paid" }] })
            await db.query(`UPDATE "Task" SET "memberPaymentStatus" = '{"e1": "PAID"}' WHERE id = $1`, [id])
            const [paid] = await listed(id)
            await expect(Tasks.deleteItem(id, admin, { type: "COST", itemId: paid.id })).rejects.toMatchObject({ message: "COST_ALREADY_PAID" })
            await expect(Tasks.deleteItem(id, admin, { type: "COST_ADDITION", itemId: paid.date })).rejects.toMatchObject({ message: "COST_ALREADY_PAID" })
            expect((await listed(id)).map(c => c.description)).toEqual(["Paid"])
            expect((await taskRow(id)).totalCost).toBe(30)
        })

        it("isn't found once the release before removed its entry, though its row is left", async () => {
            const { comments } = await taskRow("t-old")
            const twentyFive = comments.find((c: any) => c.amount === 25)
            await db.query(`UPDATE "Task" SET comments = $1 WHERE id = 't-old'`, [JSON.stringify(comments.filter((c: any) => c.costId !== twentyFive.costId))])
            expect((await listed("t-old")).map(c => c.amount)).toEqual([150, 40.5])
            await expect(Tasks.deleteItem("t-old", admin, { type: "COST", itemId: twentyFive.costId })).rejects.toMatchObject({ message: "ITEM_NOT_FOUND" })
        })
    })
})
