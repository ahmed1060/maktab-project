import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"

/**
 * The saved lists of cost names and task titles (CLIENTS_PLAN.md §5), against
 * a real Postgres: what the database holds a name to, what a picker suggests,
 * adding a name only by "+ Add", renaming, merging and archiving, and a
 * task's title and a cost's name kept as typed with the name picked.
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
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
const PLACES = `
DELETE FROM "Location";
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "updatedAt") VALUES ('port', 'c1', NULL, 'Port gate', false, 31.18, 29.87, now());
`

/**
 * A company's own roles before 5b's migration (CLIENTS_PLAN.md §5.10): one
 * without the lists' permissions, and one an Admin gave Add list names in
 * the role editor already.
 */
const OWN_ROLES = `
INSERT INTO "Role"(id, "companyId", name, "baseRole", version, "updatedAt") VALUES
 ('own-desk', 'c1', 'Front desk', 'EMPLOYEE', 3, now()),
 ('own-stores', 'c2', 'Stores', 'EMPLOYEE', 5, now());
INSERT INTO "RoleGrant"("roleId", permission, scope) VALUES ('own-desk', 'tasks.view', 'TEAM'), ('own-stores', 'lists.add', 'COMPANY');
`
const LISTS_GRANTED = "20261116000000_lists_granted"

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any
const employee = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" }) } as any
const otherAdmin = { user: withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) } as any
/** Someone whose company took the list permissions away from their role. */
const nobody = { user: { id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One", grants: "" } } as any
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null, name: "Sam Admin" } } as any

const later = () => new Date(Date.now() + 2 * 86_400_000).toISOString()
const task = (over: Record<string, unknown>) => ({ title: "Fix the door", description: "The side door sticks", assigneeIds: ["e1"], deadline: later(), difficulty: 1, locationId: "port", ...over })

describe.skipIf(!ADMIN_URL)("saved lists, in Postgres", () => {
    const dbName = `saved_lists_test_${Date.now()}`
    let db: Client
    let Lists: typeof import("@/lib/services/list.service").ListService
    let Tasks: typeof import("@/lib/services/task.service").TaskService
    let versionsBefore: Record<string, number> = {}

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
            if (m === "20261115000000_saved_lists") {
                await db.query(OWN_ROLES)
                versionsBefore = Object.fromEntries((await db.query(`SELECT id, version FROM "Role"`)).rows.map(r => [r.id, r.version]))
            }
        }
        await db.query(PLACES)
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Lists = (await import("@/lib/services/list.service")).ListService
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

    const names = async (kind: string, company = "c1") => (await db.query(`SELECT name FROM "ListEntry" WHERE "companyId" = $1 AND kind = $2 ORDER BY lower(name)`, [company, kind])).rows.map(r => r.name)
    const suggested = async (q: string, session = employee, kind = "COST_NAME") => (await Lists.suggest(session, { kind, q })).map(n => n.name)

    describe("the migration", () => {
        it("holds a name to a list once, ignoring capitals, trimmed and not empty", async () => {
            const add = (id: string, company: string, kind: string, name: string) => db.query(`INSERT INTO "ListEntry"(id, "companyId", kind, name, "updatedAt") VALUES ($1, $2, $3, $4, now())`, [id, company, kind, name])
            await add("m1", "c1", "COST_NAME", "Fuel")
            await expect(add("m2", "c1", "COST_NAME", "FUEL")).rejects.toThrow(/ListEntry_name_once/)
            // Another list, and another company, may have it.
            await add("m3", "c1", "TASK_TITLE", "Fuel")
            await add("m4", "c2", "COST_NAME", "fuel")
            await expect(add("m5", "c1", "COST_NAME", " Padded ")).rejects.toThrow(/ListEntry_name_trimmed/)
            await expect(add("m6", "c1", "COST_NAME", "")).rejects.toThrow(/ListEntry_name_trimmed/)
            await expect(add("m7", "c1", "COST_NAME", "x".repeat(201))).rejects.toThrow(/ListEntry_name_length/)
            await db.query(`DELETE FROM "ListEntry"`)
        })

        it("leaves Row Level Security on, as on every table", async () => {
            expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'ListEntry'`)).rows).toEqual([{ relrowsecurity: true }])
        })
    })

    describe("the companies already there (5b)", () => {
        const listGrants = async () => (await db.query(`
            SELECT r.id, r."companyId", r."builtIn", g.permission, g.scope FROM "Role" r JOIN "RoleGrant" g ON g."roleId" = r.id
            WHERE g.permission LIKE 'lists.%' ORDER BY r."companyId", r.id, g.permission`)).rows
        const versions = async () => Object.fromEntries((await db.query(`SELECT id, version FROM "Role"`)).rows.map(r => [r.id, r.version]))

        it("gives each built-in role the lists' permissions a new company's has", async () => {
            const rows = await listGrants()
            for (const company of ["c1", "c2"]) {
                for (const builtIn of ["ADMIN", "TEAM_LEADER", "EMPLOYEE"] as const) {
                    const given = Object.fromEntries(rows.filter(r => r.companyId === company && r.builtIn === builtIn).map(r => [r.permission, r.scope]))
                    const theirs = Object.fromEntries(Object.entries(BUILT_IN_GRANTS[builtIn]).filter(([permission]) => permission.startsWith("lists.")))
                    expect(given, `${company} ${builtIn}`).toEqual(theirs)
                }
            }
            // Only the built-in Admin manages the lists.
            expect(rows.filter(r => r.permission === "lists.manage").map(r => r.builtIn)).toEqual(["ADMIN", "ADMIN"])
        })

        it("gives a company's own roles Add list names, as Everyone has it, and keeps what they held", async () => {
            const own = (await db.query(`SELECT "roleId", permission, scope FROM "RoleGrant" WHERE "roleId" LIKE 'own-%' ORDER BY "roleId", permission`)).rows
            expect(own).toEqual([
                { roleId: "own-desk", permission: "lists.add", scope: "COMPANY" },
                { roleId: "own-desk", permission: "tasks.view", scope: "TEAM" },
                { roleId: "own-stores", permission: "lists.add", scope: "COMPANY" },
            ])
        })

        it("has the holders of a role given one reload their grants, and only them", async () => {
            const now = await versions()
            expect(Object.keys(versionsBefore).length).toBeGreaterThan(2)
            for (const [id, before] of Object.entries(versionsBefore)) {
                // Stores held Add list names already, so nothing changed for it.
                expect(now[id], id).toBe(id === "own-stores" ? before : before + 1)
            }
        })

        it("changes nothing run again", async () => {
            const [grants, before] = [await listGrants(), await versions()]
            await db.query(sql(LISTS_GRANTED))
            expect(await listGrants()).toEqual(grants)
            expect(await versions()).toEqual(before)
        })
    })

    describe("adding a name", () => {
        it("is \"+ Add\", for whoever may add names, trimmed", async () => {
            expect(await Lists.add(employee, { kind: "COST_NAME", name: "  Transport " })).toMatchObject({ name: "Transport" })
            await expect(Lists.add(nobody, { kind: "COST_NAME", name: "Parking" })).rejects.toMatchObject({ message: "LIST_NAME_FORBIDDEN" })
            expect(await names("COST_NAME")).toEqual(["Transport"])
            const [row] = (await db.query(`SELECT "userId", details FROM "AuditLog" WHERE action = 'ADD_LIST_NAME'`)).rows
            expect(row).toEqual({ userId: "e1", details: { kind: "COST_NAME", name: "Transport" } })
        })

        it("gives back the name already there, ignoring capitals, rather than a second", async () => {
            const [first] = (await db.query(`SELECT id FROM "ListEntry" WHERE name = 'Transport'`)).rows
            expect(await Lists.add(admin, { kind: "COST_NAME", name: "TRANSPORT" })).toEqual({ id: first.id, name: "Transport" })
            const both = await Promise.all([Lists.add(employee, { kind: "COST_NAME", name: "Tolls" }), Lists.add(admin, { kind: "COST_NAME", name: "tolls" })])
            expect(both[0].id).toBe(both[1].id)
            expect(await names("COST_NAME")).toEqual(["Tolls", "Transport"])
        })

        it("holds a title to what a task's title takes, and a cost's name to 200 characters", async () => {
            await expect(Lists.add(admin, { kind: "TASK_TITLE", name: "Go" })).rejects.toMatchObject({ message: "LIST_NAME_TOO_SHORT" })
            await expect(Lists.add(admin, { kind: "TASK_TITLE", name: "x".repeat(101) })).rejects.toMatchObject({ message: "LIST_NAME_TOO_LONG" })
            await expect(Lists.add(admin, { kind: "COST_NAME", name: "   " })).rejects.toMatchObject({ message: "LIST_NAME_REQUIRED" })
            await expect(Lists.add(admin, { kind: "OTHER", name: "Fine" })).rejects.toMatchObject({ message: "LIST_KIND_INVALID" })
            expect(await Lists.add(admin, { kind: "COST_NAME", name: "x".repeat(200) })).toMatchObject({ name: "x".repeat(200) })
            await db.query(`DELETE FROM "ListEntry" WHERE length(name) = 200`)
        })

        it("is a Super Admin's in the company they pick, which must exist", async () => {
            await expect(Lists.add(superAdmin, { kind: "TASK_TITLE", name: "Inspect" })).rejects.toMatchObject({ message: "COMPANY_SELECTION_REQUIRED" })
            await expect(Lists.add(superAdmin, { kind: "TASK_TITLE", name: "Inspect", companyId: "nope" })).rejects.toMatchObject({ message: "COMPANY_NOT_FOUND" })
            await Lists.add(superAdmin, { kind: "TASK_TITLE", name: "Inspect the lift", companyId: "c2" })
            expect(await names("TASK_TITLE", "c2")).toEqual(["Inspect the lift"])
        })
    })

    describe("what a picker suggests", () => {
        it("is the names that contain what's typed, ignoring capitals, those starting with it first", async () => {
            await Lists.add(admin, { kind: "COST_NAME", name: "Rail transport" })
            expect(await suggested("trans")).toEqual(["Transport", "Rail transport"])
            expect(await suggested("TOLL")).toEqual(["Tolls"])
            expect(await suggested("")).toEqual([])
        })

        it("is eight at most, never another company's, and takes % and _ as typed", async () => {
            for (let i = 1; i <= 10; i++) await Lists.add(admin, { kind: "COST_NAME", name: `Fee ${i}` })
            expect(await suggested("fee")).toHaveLength(8)
            await Lists.add(otherAdmin, { kind: "COST_NAME", name: "Transport fee" })
            expect(await suggested("transport")).toEqual(["Transport", "Rail transport"])
            await Lists.add(admin, { kind: "COST_NAME", name: "10% discount" })
            expect(await suggested("%")).toEqual(["10% discount"])
            expect(await suggested("_")).toEqual([])
        })
    })

    describe("managing a list", () => {
        const idOf = async (name: string, company = "c1") => (await db.query(`SELECT id FROM "ListEntry" WHERE name = $1 AND "companyId" = $2`, [name, company])).rows[0].id

        it("lists every name, archived ones too, with how often each is used, for whoever manages lists", async () => {
            await expect(Lists.list(employee, { kind: "COST_NAME" })).rejects.toMatchObject({ message: "LIST_NAME_FORBIDDEN" })
            const all = await Lists.list(admin, { kind: "COST_NAME" })
            expect(all.find(n => n.name === "Transport")).toMatchObject({ archived: false, uses: 0 })
        })

        it("renames a name, but not to another already there, and not another company's", async () => {
            const id = await idOf("Rail transport")
            await expect(Lists.rename(employee, { id, name: "Train" })).rejects.toMatchObject({ message: "LIST_NAME_FORBIDDEN" })
            await expect(Lists.rename(admin, { id, name: "transport" })).rejects.toMatchObject({ message: "LIST_NAME_TAKEN" })
            await expect(Lists.rename(otherAdmin, { id, name: "Train" })).rejects.toMatchObject({ message: "LIST_NAME_NOT_FOUND" })
            expect(await Lists.rename(admin, { id, name: "Train" })).toEqual({ id, name: "Train" })
            // Its own capitals may change.
            expect(await Lists.rename(admin, { id, name: "TRAIN" })).toEqual({ id, name: "TRAIN" })
        })

        it("archives a name, so it isn't suggested or added again, and restores it", async () => {
            const id = await idOf("Tolls")
            await Lists.setArchived(admin, { id, archived: true })
            expect(await suggested("toll")).toEqual([])
            await expect(Lists.add(employee, { kind: "COST_NAME", name: "tolls" })).rejects.toMatchObject({ message: "LIST_NAME_ARCHIVED" })
            expect((await Lists.list(admin, { kind: "COST_NAME" })).find(n => n.id === id)).toMatchObject({ archived: true })
            await Lists.setArchived(admin, { id, archived: false })
            expect(await suggested("toll")).toEqual(["Tolls"])
        })
    })

    describe("a task's title and a cost's name", () => {
        let taskId: string
        const titleOf = async (id: string) => (await db.query(`SELECT title, "titleEntryId" FROM "Task" WHERE id = $1`, [id])).rows[0]
        const idOf = async (name: string) => (await db.query(`SELECT id FROM "ListEntry" WHERE name = $1 AND "companyId" = 'c1'`, [name])).rows[0].id

        it("keeps the title as typed, with the name it was picked as", async () => {
            const picked = await Lists.add(admin, { kind: "TASK_TITLE", name: "Fix the door" })
            taskId = (await Tasks.create(task({ title: "Fix the door", titleEntryId: picked.id }) as any, admin)).id
            expect(await titleOf(taskId)).toEqual({ title: "Fix the door", titleEntryId: picked.id })
        })

        it("drops a name typed over since it was picked, and refuses another company's or an archived one", async () => {
            const picked = await idOf("Fix the door")
            const typed = (await Tasks.create(task({ title: "Fix the front door", titleEntryId: picked }) as any, admin)).id
            expect(await titleOf(typed)).toEqual({ title: "Fix the front door", titleEntryId: null })
            const theirs = (await Lists.add(otherAdmin, { kind: "TASK_TITLE", name: "Their title" })).id
            await expect(Tasks.create(task({ title: "Their title", titleEntryId: theirs }) as any, admin)).rejects.toMatchObject({ message: "LIST_NAME_NOT_FOUND" })
            const costName = await idOf("Transport")
            await expect(Tasks.create(task({ title: "Transport", titleEntryId: costName }) as any, admin)).rejects.toMatchObject({ message: "LIST_NAME_NOT_FOUND" })
            const old = (await Lists.add(admin, { kind: "TASK_TITLE", name: "Old title" })).id
            await Lists.setArchived(admin, { id: old, archived: true })
            await expect(Tasks.create(task({ title: "Old title", titleEntryId: old }) as any, admin)).rejects.toMatchObject({ message: "LIST_NAME_ARCHIVED" })
        })

        it("keeps an edited task's name while its title stays, and its new title's, or none if typed", async () => {
            const picked = await idOf("Fix the door")
            await Tasks.updateDetails(taskId, { description: "The side door sticks badly" } as any, admin)
            expect(await titleOf(taskId)).toEqual({ title: "Fix the door", titleEntryId: picked })
            // Archived since, it stays with the task it's on.
            await Lists.setArchived(admin, { id: picked, archived: true })
            await Tasks.updateDetails(taskId, { title: "Fix the door", titleEntryId: picked } as any, admin)
            expect((await titleOf(taskId)).titleEntryId).toBe(picked)
            await Tasks.updateDetails(taskId, { title: "Fix the hinge" } as any, admin)
            expect(await titleOf(taskId)).toEqual({ title: "Fix the hinge", titleEntryId: null })
            await Lists.setArchived(admin, { id: picked, archived: false })
        })

        it("keeps a cost's name as typed, with the name it was picked as", async () => {
            const transport = await idOf("Transport")
            await db.query(`UPDATE "Task" SET status = 'IN_PROGRESS' WHERE id = $1`, [taskId])
            await Tasks.submit(taskId, "e1", employee, { isDraft: true, costs: [{ amount: 50, description: "transport", nameEntryId: transport }, { amount: 20, description: "Taxi home", nameEntryId: transport }] })
            const rows = (await db.query(`SELECT description, "nameEntryId" FROM "TaskCost" WHERE "taskId" = $1 ORDER BY amount DESC`, [taskId])).rows
            expect(rows).toEqual([{ description: "transport", nameEntryId: transport }, { description: "Taxi home", nameEntryId: null }])
        })

        it("follows a name merged into another, its text as it was, and the merged one goes", async () => {
            const transport = await idOf("Transport")
            const train = await idOf("TRAIN")
            await expect(Lists.merge(admin, { id: transport, into: transport })).rejects.toMatchObject({ message: "LIST_MERGE_SELF" })
            await expect(Lists.merge(admin, { id: transport, into: await idOf("Fix the door") })).rejects.toMatchObject({ message: "LIST_NAME_NOT_FOUND" })
            await expect(Lists.merge(employee, { id: transport, into: train })).rejects.toMatchObject({ message: "LIST_NAME_FORBIDDEN" })
            expect(await Lists.merge(admin, { id: transport, into: train })).toEqual({ id: train, name: "TRAIN" })
            const rows = (await db.query(`SELECT description, "nameEntryId" FROM "TaskCost" WHERE "taskId" = $1 AND "nameEntryId" IS NOT NULL`, [taskId])).rows
            expect(rows).toEqual([{ description: "transport", nameEntryId: train }])
            expect(await names("COST_NAME")).not.toContain("Transport")
            expect((await Lists.list(admin, { kind: "COST_NAME" })).find(n => n.id === train)).toMatchObject({ uses: 1 })
            const [log] = (await db.query(`SELECT details FROM "AuditLog" WHERE action = 'MERGE_LIST_NAMES'`)).rows
            expect(log.details).toEqual({ name: "Transport", into: "TRAIN", uses: 1 })
        })
    })
})
