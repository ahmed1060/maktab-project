import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { pendingCostsWhere } from "@/lib/services/costs-query"
import { TaskService } from "@/lib/services/task.service"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * One employee's costs on the Costs page, and Mark all as paid for them
 * (CLIENTS_PLAN.md §1), against a real Postgres built from the migrations:
 * which tasks list for them, and that paying them pays their shares only.
 * The shares are JSON, so what is checked is how Postgres reads them: a share
 * with no status is still to pay, though to Postgres the key isn't there.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ali', 'Hassan', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Mona', 'Adel', 'EMPLOYEE', 2026, 'e2', 'c1');
`
const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
const session = { user: admin }

describe.skipIf(!ADMIN_URL)("one employee's costs, in Postgres", () => {
    const dbName = `costs_pay_test_${Date.now()}`
    let db: Client

    /** A reviewed task waiting to be paid, shared by Ali and Mona; its total is its shares' unless given. */
    const task = async (id: string, shares: Record<string, number> | null, statuses: object | null, total = shares ? Object.values(shares).reduce((a, b) => a + b, 0) : 300) => {
        await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "totalCost", "memberCosts", "memberPaymentStatus", "companyId", "updatedAt")
            VALUES ($1, $1, '', 'APPROVED', now(), $4, $2, $3, 'c1', now())`, [id, shares, statuses, total])
        await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ($1, 'e1'), ($1, 'e2')`, [id])
    }
    const listed = async (employeeId?: string) => {
        const { prisma } = await import("@/lib/prisma")
        const where = await pendingCostsWhere(admin, { employeeId })
        return (await prisma.task.findMany({ where: where!, select: { id: true }, orderBy: { id: "asc" } })).map(t => t.id)
    }
    const row = async (id: string) => (await db.query(`SELECT "memberPaymentStatus" AS paid, "paymentStatus" AS task, status FROM "Task" WHERE id = $1`, [id])).rows[0]

    beforeAll(async () => {
        const server = new Client({ connectionString: ADMIN_URL })
        await server.connect()
        await server.query(`CREATE DATABASE ${dbName}`)
        await server.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const server = new Client({ connectionString: ADMIN_URL })
        await server.connect()
        await server.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await server.end()
    })

    it("lists the tasks where their share is still to pay, a share with no status among them", async () => {
        await task("t1-both", { e1: 100, e2: 200 }, { e1: "PENDING_PAYMENT", e2: "PENDING_PAYMENT" })
        await task("t2-ali-paid", { e1: 100, e2: 200 }, { e1: "PAID", e2: "PENDING_PAYMENT" })
        await task("t3-mona-unmarked", { e1: 100, e2: 200 }, { e1: "PENDING_PAYMENT" })
        await task("t4-no-statuses", { e1: 100, e2: 200 }, null)
        await task("t5-mona-nothing", { e1: 100, e2: 0 }, {})
        await task("t6-mona-paid", { e1: 100, e2: 200 }, { e2: "PAID" })
        await task("t7-not-split", null, null)
        expect(await listed("e2")).toEqual(["t1-both", "t2-ali-paid", "t3-mona-unmarked", "t4-no-statuses"])
        expect(await listed("e1")).toEqual(["t1-both", "t3-mona-unmarked", "t4-no-statuses", "t5-mona-nothing", "t6-mona-paid"])
        // With no one picked, every task still waiting, as before.
        expect(await listed()).toHaveLength(7)
    })

    it("pays the picked employee's share only, and the task once no share is left", async () => {
        const ids = await listed("e2")
        expect(await TaskService.bulkUpdatePayment(ids, session, "e2")).toEqual({ count: 4 })
        expect(await row("t1-both")).toEqual({ paid: { e1: "PENDING_PAYMENT", e2: "PAID" }, task: "PENDING_PAYMENT", status: "APPROVED" })
        expect(await row("t2-ali-paid")).toEqual({ paid: { e1: "PAID", e2: "PAID" }, task: "PAID", status: "COMPLETED" })
        expect(await row("t3-mona-unmarked")).toEqual({ paid: { e1: "PENDING_PAYMENT", e2: "PAID" }, task: "PENDING_PAYMENT", status: "APPROVED" })
        expect(await row("t4-no-statuses")).toEqual({ paid: { e2: "PAID" }, task: "PENDING_PAYMENT", status: "APPROVED" })
        // Nothing of Mona's is left to list, and Ali's shares are where they were.
        expect(await listed("e2")).toEqual([])
        expect(await listed("e1")).toEqual(["t1-both", "t3-mona-unmarked", "t4-no-statuses", "t5-mona-nothing", "t6-mona-paid"])
    })

    it("pays both shares when both employees are paid at once", async () => {
        await task("t8-race", { e1: 100, e2: 200 }, { e1: "PENDING_PAYMENT", e2: "PENDING_PAYMENT" })
        // Each write waits half a second, so the two payments overlap: each
        // read the task before the other wrote it.
        await db.query(`CREATE FUNCTION slow_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$;
            CREATE TRIGGER slow_task BEFORE UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION slow_task()`)
        try {
            await Promise.all([TaskService.bulkUpdatePayment(["t8-race"], session, "e1"), TaskService.bulkUpdatePayment(["t8-race"], session, "e2")])
        } finally {
            await db.query(`DROP TRIGGER slow_task ON "Task"; DROP FUNCTION slow_task()`)
        }
        expect(await row("t8-race")).toEqual({ paid: { e1: "PAID", e2: "PAID" }, task: "PAID", status: "COMPLETED" })
    })

    it("pays a task from its own page once no share is left, whoever else has a status", async () => {
        // Mona has a status but no share; Ali's share removed down to nothing.
        await task("t9-no-share", { e1: 100 }, { e1: "PENDING_PAYMENT", e2: "PENDING_PAYMENT" })
        await task("t10-zero-share", { e1: 0, e2: 200 }, { e1: "PENDING_PAYMENT", e2: "PENDING_PAYMENT" })
        await TaskService.updatePayment("t9-no-share", session, { paymentStatus: "PAID", targetUserId: "e1" })
        await TaskService.updatePayment("t10-zero-share", session, { paymentStatus: "PAID", targetUserId: "e2" })
        // Paid, as the Costs page counts it: it lists neither once nothing is left to pay.
        expect(await row("t9-no-share")).toMatchObject({ task: "PAID", status: "COMPLETED" })
        expect(await row("t10-zero-share")).toMatchObject({ task: "PAID", status: "COMPLETED" })
        // And one with a share left stays waiting for it.
        await task("t11-ali-owes", { e1: 100, e2: 200 }, { e1: "PENDING_PAYMENT", e2: "PENDING_PAYMENT" })
        await TaskService.updatePayment("t11-ali-owes", session, { paymentStatus: "PAID", targetUserId: "e2" })
        expect(await row("t11-ali-owes")).toMatchObject({ task: "PENDING_PAYMENT", status: "APPROVED" })
    })

    it("keeps a task waiting while some of its cost is no one's share, until the task is paid whole", async () => {
        // 100 EGP from before shares, then Ali's 50: his share is all that's split.
        await task("t12-old-cost", { e1: 50 }, { e1: "PENDING_PAYMENT" }, 150)
        await task("t13-old-cost", { e1: 50 }, { e1: "PENDING_PAYMENT" }, 150)
        await TaskService.updatePayment("t12-old-cost", session, { paymentStatus: "PAID", targetUserId: "e1" })
        await TaskService.bulkUpdatePayment(["t13-old-cost"], session, "e1")
        expect(await row("t12-old-cost")).toEqual({ paid: { e1: "PAID" }, task: "PENDING_PAYMENT", status: "APPROVED" })
        expect(await row("t13-old-cost")).toEqual({ paid: { e1: "PAID" }, task: "PENDING_PAYMENT", status: "APPROVED" })
        // Still listed with no one picked, where its own 100 EGP is, and paid with it.
        expect(await listed()).toContain("t12-old-cost")
        await TaskService.bulkUpdatePayment(["t12-old-cost"], session)
        expect(await row("t12-old-cost")).toMatchObject({ task: "PAID", status: "COMPLETED" })
    })

    it("pays every share of each task with no one picked, as before", async () => {
        await TaskService.bulkUpdatePayment(["t1-both", "t7-not-split"], session)
        expect(await row("t1-both")).toEqual({ paid: { e1: "PAID", e2: "PAID" }, task: "PAID", status: "COMPLETED" })
        expect(await row("t7-not-split")).toMatchObject({ task: "PAID", status: "COMPLETED" })
    })
})
