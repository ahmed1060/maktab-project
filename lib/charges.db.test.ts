import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"

/**
 * Client charges (CLIENTS_PLAN.md §6, step 6b), against a real Postgres: a
 * cost on a task with a client is charged to it. Who sees which charges, the
 * Charged to clients tab's filters and totals, the service fee and the "Not
 * charged to client" tick, what the database holds to, and the rules around
 * a collected charge and a task with charges.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('t1', 't1@x', 'p', 'Tamer', 'One', 'TEAM_LEADER', 2026, 't1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 't1'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
// Al Noor's task (Ehab's, in Tamer's team) with two charges; Delta Foods'
// (Eman's) with one left off the bill and one collected; a task with no
// client, whose cost is no charge; and another company's.
const CHARGES = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('noor', 'c1', 'Al Noor', 'Omar', '0100', 'Cairo', now()),
 ('delta', 'c1', 'Delta Foods', 'Dina', '0101', 'Giza', now()),
 ('theirs', 'c2', 'Their client', 'Tarek', '0102', 'Alex', now());
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES
 ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now()),
 ('dock', 'c2', NULL, 'Dock', false, 31.2, 29.9, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "locationId", "updatedAt") VALUES
 ('k1', 'Fix the gate', 'd', 'APPROVED', now() + interval '2 days', 'c1', 'noor', 'port', now()),
 ('k2', 'Paint the office', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'delta', 'port', now()),
 ('k3', 'Staff lunch', 'd', 'APPROVED', now() + interval '2 days', 'c1', NULL, 'port', now()),
 ('k4', 'Cancelled visit', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'noor', 'port', now()),
 ('k9', 'Their task', 'd', 'APPROVED', now() + interval '2 days', 'c2', 'theirs', 'dock', now());
INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('k1', 'e1'), ('k2', 'e2'), ('k3', 'e1'), ('k4', 'e2');
INSERT INTO "TaskCost"(id, "taskId", "authorId", "authorName", amount, description, "notCharged", "collectedAt", "collectedById", "createdAt") VALUES
 ('x1', 'k1', 'e1', 'Ehab One', 100, 'Taxi', false, NULL, NULL, '2026-10-20T09:00:00Z'),
 ('x2', 'k1', 'e1', 'Ehab One', 250.5, 'Gate parts', false, NULL, NULL, '2026-10-21T09:00:00Z'),
 ('x3', 'k2', 'e2', 'Eman One', 300, 'Paint', true, NULL, NULL, '2026-10-22T09:00:00Z'),
 ('x4', 'k2', 'e2', 'Eman One', 40, 'Brushes', false, '2026-10-25T09:00:00Z', 'a1', '2026-10-22T10:00:00Z'),
 ('x5', 'k3', 'e1', 'Ehab One', 50, 'Lunch', false, NULL, NULL, '2026-10-23T09:00:00Z'),
 ('x6', 'k4', 'e2', 'Eman One', 20, 'Bus', true, NULL, NULL, '2026-10-24T09:00:00Z'),
 ('x9', 'k9', NULL, 'Someone', 99, 'Theirs', false, NULL, NULL, '2026-10-24T09:00:00Z');
`

/**
 * Before 6c's migration (CLIENTS_PLAN.md §6.8): a company's own role, and
 * Two's built-in Team Leader, whom an Admin gave See charges for the whole
 * company in the role editor already.
 */
const BEFORE_GRANTED = `
INSERT INTO "Role"(id, "companyId", name, "baseRole", version, "updatedAt") VALUES ('own-desk', 'c1', 'Front desk', 'EMPLOYEE', 3, now());
INSERT INTO "RoleGrant"("roleId", permission, scope) VALUES ('own-desk', 'tasks.view', 'TEAM');
INSERT INTO "RoleGrant"("roleId", permission, scope) SELECT id, 'charges.view', 'COMPANY' FROM "Role" WHERE "companyId" = 'c2' AND "builtIn" = 'TEAM_LEADER';
`
const CHARGES_GRANTED = "20261119000000_charges_granted"

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any
const leader = { user: withGrants({ id: "t1", role: "TEAM_LEADER", companyId: "c1", name: "Tamer One" }) } as any
const employee = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" }) } as any
const otherAdmin = { user: withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) } as any

describe.skipIf(!ADMIN_URL)("client charges, in Postgres", () => {
    const dbName = `charges_test_${Date.now()}`
    let db: Client
    let dbUrl: string
    let charges: typeof import("@/lib/services/charge.service")
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let prisma: typeof import("@/lib/prisma").prisma
    let rolesBefore: { id: string; companyId: string; builtIn: string | null; version: number }[] = []

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
            if (m === "20261118000000_client_charges") {
                await db.query(BEFORE_GRANTED)
                rolesBefore = (await db.query(`SELECT id, "companyId", "builtIn", version FROM "Role" ORDER BY id`)).rows
            }
        }
        await db.query(CHARGES)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        charges = await import("@/lib/services/charge.service")
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

    /** The charges this person sees with these filters, by id, and their totals. */
    const listed = async (session: any, filters: Record<string, string> = {}) => {
        const where = await charges.chargesWhere(session.user, filters)
        if (!where) return null
        const rows = await prisma.taskCost.findMany({ where, select: { id: true }, orderBy: { id: "asc" } })
        return { ids: rows.map(r => r.id), totals: await charges.chargeTotals(where) }
    }

    it("lists the company's charges, the Due ones as the tab opens, and adds them up", async () => {
        expect(await listed(admin)).toEqual({ ids: ["x1", "x2"], totals: { paidOut: 350.5, serviceFees: 0, totalDue: 350.5 } })
        // Every status: the one left off the bill counts in no total, and the collected one isn't due.
        expect(await listed(admin, { status: "all" })).toEqual({ ids: ["x1", "x2", "x3", "x4", "x6"], totals: { paidOut: 390.5, serviceFees: 0, totalDue: 350.5 } })
        expect((await listed(admin, { status: "collected" }))!.ids).toEqual(["x4"])
        expect((await listed(admin, { status: "not_charged" }))!.ids).toEqual(["x3", "x6"])
        // A status that isn't one is Due.
        expect((await listed(admin, { status: "nonsense" }))!.ids).toEqual(["x1", "x2"])
    })

    it("filters by client, the day it was added and what it says", async () => {
        expect((await listed(admin, { status: "all", clientId: "delta" }))!.ids).toEqual(["x3", "x4"])
        expect((await listed(admin, { status: "all", dateFrom: "2026-10-21", dateTo: "2026-10-22" }))!.ids).toEqual(["x2", "x3", "x4"])
        expect((await listed(admin, { status: "all", search: "GATE" }))!.ids).toEqual(["x1", "x2"])
        expect((await listed(admin, { status: "all", search: "brush" }))!.ids).toEqual(["x4"])
    })

    it("shows a Team Leader their team's tasks' charges, and nobody else's", async () => {
        // Eman isn't in Tamer's team, so the cancelled visit isn't his to see.
        expect((await listed(leader, { status: "all" }))!.ids).toEqual(["x1", "x2"])
        expect(await listed(employee)).toBeNull()
        expect((await listed(otherAdmin, { status: "all" }))!.ids).toEqual(["x9"])
    })

    it("sets a service fee, typed as the fee or as the total, never below what was paid", async () => {
        expect(await charges.ChargeService.setServiceFee(admin, "x1", { serviceFee: 15 })).toEqual({ id: "x1", serviceFee: 15, total: 115 })
        expect(await charges.ChargeService.setServiceFee(admin, "x2", { total: "300" })).toEqual({ id: "x2", serviceFee: 49.5, total: 300 })
        await expect(charges.ChargeService.setServiceFee(admin, "x2", { total: 250 })).rejects.toMatchObject({ message: "CHARGE_TOTAL_BELOW_PAID" })
        for (const serviceFee of [-1, "abc", null, 2_000_000, Infinity]) {
            await expect(charges.ChargeService.setServiceFee(admin, "x1", { serviceFee }), String(serviceFee)).rejects.toMatchObject({ message: "CHARGE_FEE_INVALID" })
        }
        expect((await listed(admin))!.totals).toEqual({ paidOut: 350.5, serviceFees: 64.5, totalDue: 415 })
        const logged = (await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SET_SERVICE_FEE' ORDER BY "createdAt"`)).rows.map(r => r.details)
        expect(logged).toEqual([{ costId: "x1", from: 0, to: 15 }, { costId: "x2", from: 0, to: 49.5 }])
    })

    it("changes none collected, left off the bill, with no client, or not theirs to manage", async () => {
        const fee = (session: any, id: string) => charges.ChargeService.setServiceFee(session, id, { serviceFee: 5 })
        await expect(fee(admin, "x4")).rejects.toMatchObject({ message: "CHARGE_COLLECTED" })
        await expect(fee(admin, "x3")).rejects.toMatchObject({ message: "CHARGE_NOT_CHARGED" })
        await expect(fee(admin, "x5")).rejects.toMatchObject({ message: "CHARGE_NOT_FOUND" })
        await expect(fee(admin, "gone")).rejects.toMatchObject({ message: "CHARGE_NOT_FOUND" })
        await expect(fee(otherAdmin, "x1")).rejects.toMatchObject({ message: "CHARGE_NOT_FOUND" })
        // See charges isn't Manage charges.
        await expect(fee(leader, "x1")).rejects.toMatchObject({ message: "CHARGE_NOT_FOUND" })
        await expect(charges.ChargeService.setNotCharged(admin, "x4", true)).rejects.toMatchObject({ message: "CHARGE_COLLECTED" })
    })

    it("leaves a cost off its client's bill with Not charged to client, and charges it again", async () => {
        await charges.ChargeService.setNotCharged(admin, "x1", true)
        expect((await listed(admin))!.ids).toEqual(["x2"])
        expect((await listed(admin, { status: "not_charged" }))!.ids).toEqual(["x1", "x3", "x6"])
        await charges.ChargeService.setNotCharged(admin, "x1", false)
        expect((await listed(admin))!.ids).toEqual(["x1", "x2"])
        await expect(charges.ChargeService.setNotCharged(admin, "x1", "yes")).rejects.toMatchObject({ message: "CHARGE_TICK_INVALID" })
        const logged = (await db.query(`SELECT details FROM "AuditLog" WHERE action = 'SET_NOT_CHARGED' ORDER BY "createdAt"`)).rows.map(r => r.details)
        expect(logged).toEqual([{ costId: "x1", notCharged: true }, { costId: "x1", notCharged: false }])
    })

    it("holds a fee to nothing or more, and one left off the bill uncollected, in the database itself", async () => {
        await expect(db.query(`UPDATE "TaskCost" SET "serviceFee" = -1 WHERE id = 'x1'`)).rejects.toThrow(/TaskCost_serviceFee_check/)
        await expect(db.query(`UPDATE "TaskCost" SET "notCharged" = true WHERE id = 'x4'`)).rejects.toThrow(/TaskCost_notCharged_check/)
    })

    it("keeps a collected charge on its cost and its client: the cost stays, and the client doesn't change", async () => {
        await expect(Tasks.deleteItem("k2", admin, { type: "COST", itemId: "x4" })).rejects.toMatchObject({ message: "COST_CHARGE_COLLECTED" })
        await expect(Tasks.updateDetails("k2", { clientId: "noor" } as any, admin)).rejects.toMatchObject({ message: "CLIENT_HAS_COLLECTED_CHARGES" })
        expect((await db.query(`SELECT "clientId" FROM "Task" WHERE id = 'k2'`)).rows[0].clientId).toBe("delta")
    })

    it("moves a task's charges with it to its new client, until one is collected", async () => {
        await Tasks.updateDetails("k1", { clientId: "delta" } as any, admin)
        expect((await listed(admin, { clientId: "delta" }))!.ids).toEqual(["x1", "x2"])
        await Tasks.updateDetails("k1", { clientId: "noor" } as any, admin)
        expect((await listed(admin, { clientId: "noor" }))!.ids).toEqual(["x1", "x2"])
    })

    it("waits for its task while something else holds it, as deleting the task does", async () => {
        // A delete that has read the task's charges as none holds the task
        // until it's gone: charging one of its costs again meanwhile would
        // have it deleted, charged.
        const deleting = new Client({ connectionString: dbUrl })
        await deleting.connect()
        await deleting.query("BEGIN")
        await deleting.query(`SELECT id FROM "Task" WHERE id = 'k4' FOR UPDATE`)
        let charged = false
        const charging = charges.ChargeService.setNotCharged(admin, "x6", false).then(() => { charged = true })
        await new Promise(r => setTimeout(r, 500))
        const chargedWhileHeld = charged
        await deleting.query("ROLLBACK")
        await deleting.end()
        await charging
        // As it was, for the delete below.
        await charges.ChargeService.setNotCharged(admin, "x6", true)
        expect(chargedWhileHeld).toBe(false)
        expect(charged).toBe(true)
    })

    it("keeps a task whose costs are charged to its client, and deletes one whose costs are all left off", async () => {
        await expect(Tasks.delete("k1", admin)).rejects.toMatchObject({ message: "TASK_HAS_CHARGES" })
        await Tasks.delete("k4", admin)
        // With no client, its costs are no charges.
        await Tasks.delete("k3", admin)
        expect((await db.query(`SELECT id FROM "Task" WHERE id IN ('k1', 'k3', 'k4') ORDER BY id`)).rows.map(r => r.id)).toEqual(["k1"])
    })

    describe("the companies already there (6c)", () => {
        const chargeGrants = async () => (await db.query(`
            SELECT r.id, r."companyId", r."builtIn", g.permission, g.scope FROM "Role" r JOIN "RoleGrant" g ON g."roleId" = r.id
            WHERE g.permission LIKE 'charges.%' ORDER BY r."companyId", r.id, g.permission`)).rows
        const versions = async () => Object.fromEntries((await db.query(`SELECT id, version FROM "Role"`)).rows.map(r => [r.id, r.version]))
        const givenOne = (r: { companyId: string; builtIn: string | null }) =>
            r.builtIn === "ADMIN" || (r.builtIn === "TEAM_LEADER" && r.companyId !== "c2")

        it("gives the built-in Admin and Team Leader roles the charges' permissions a new company's have", async () => {
            const rows = await chargeGrants()
            for (const company of ["c1", "c2"]) {
                for (const builtIn of ["ADMIN", "TEAM_LEADER", "EMPLOYEE"] as const) {
                    const given = Object.fromEntries(rows.filter(r => r.companyId === company && r.builtIn === builtIn).map(r => [r.permission, r.scope]))
                    const theirs = Object.fromEntries(Object.entries(BUILT_IN_GRANTS[builtIn]).filter(([permission]) => permission.startsWith("charges.")))
                    // Two's Team Leader was given See charges for the company in the role editor, and keeps it.
                    expect(given, `${company} ${builtIn}`).toEqual(company === "c2" && builtIn === "TEAM_LEADER" ? { "charges.view": "COMPANY" } : theirs)
                }
            }
            // A company's own roles are given them in the role editor.
            expect(rows.filter(r => r.builtIn === null)).toEqual([])
        })

        it("has the holders of a role given one reload their grants, and only them", async () => {
            const now = await versions()
            expect(rolesBefore.length).toBe(7)
            for (const role of rolesBefore) expect(now[role.id], `${role.companyId} ${role.builtIn ?? role.id}`).toBe(givenOne(role) ? role.version + 1 : role.version)
        })

        it("changes nothing run again", async () => {
            const [grants, before] = [await chargeGrants(), await versions()]
            await db.query(sql(CHARGES_GRANTED))
            expect(await chargeGrants()).toEqual(grants)
            expect(await versions()).toEqual(before)
        })
    })
})
