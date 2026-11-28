import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Deleting a location no task has used (LATER_CHANGES_PLAN.md §7.21;
 * DESIGN.md §5.5, Row menu), against a real Postgres: which locations a
 * task has used, deleting one, what keeps one, and a task added at one
 * while it's being deleted.
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
 ('l1', 'l1@x', 'p', 'Laila', 'One', 'TEAM_LEADER', 2026, 'l1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`

// Acme's HQ, a site of its no task has used, and one a task has; shared
// places, one archived; places for the tasks added meanwhile; another
// company's.
const PLACES = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('k1', 'c1', 'Acme', 'Mona', '0100', 'Nasr City', now()),
 ('k9', 'c2', 'Theirs', 'Sara', '0102', 'Far away', now());
DELETE FROM "Location";
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "radiusMeters", "archivedAt", "updatedAt") VALUES
 ('acme-hq', 'c1', 'k1', 'Nasr City', true, 30.0444, 31.2357, 150, NULL, now()),
 ('acme-site', 'c1', 'k1', 'Maadi site', false, 29.9602, 31.2569, NULL, NULL, now()),
 ('acme-used', 'c1', 'k1', 'Dokki site', false, 30.0383, 31.2109, NULL, NULL, now()),
 ('port', 'c1', NULL, 'Port gate', false, 31.1849, 29.8737, 80, NULL, now()),
 ('old', 'c1', NULL, 'Old depot', false, 30.1, 31.1, NULL, now(), now()),
 ('anchor', 'c1', NULL, 'Anchor yard', false, 30.2, 31.2, NULL, NULL, now()),
 ('race-add', 'c1', NULL, 'Bridge', false, 30.3, 31.3, NULL, NULL, now()),
 ('race-create', 'c1', NULL, 'Ferry', false, 30.4, 31.4, NULL, NULL, now()),
 ('race-edit', 'c1', NULL, 'Quay', false, 30.5, 31.5, NULL, NULL, now()),
 ('race-late', 'c1', NULL, 'Pier', false, 30.6, 31.6, NULL, NULL, now()),
 ('twice', 'c1', NULL, 'Jetty', false, 30.7, 31.7, NULL, NULL, now()),
 ('theirs', 'c2', 'k9', 'Far away', true, 25.7, 32.6, NULL, NULL, now()),
 ('their-shed', 'c2', NULL, 'Shed', false, 25.8, 32.7, NULL, NULL, now());
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "locationId", "updatedAt") VALUES
 ('used-task', 'Fix the gate', 'd', 'IN_PROGRESS', now() + interval '3 days', 'c1', 'k1', 'acme-used', now()),
 ('edit-me', 'Paint the shed', 'd', 'IN_PROGRESS', now() + interval '3 days', 'c1', NULL, 'anchor', now());
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any
// A Team Leader may add locations, never archive or delete them.
const leader = { user: withGrants({ id: "l1", role: "TEAM_LEADER", companyId: "c1" }) } as any
const otherAdmin = { user: withGrants({ id: "a2", role: "ADMIN", companyId: "c2" }) } as any
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } } as any

const later = () => new Date(Date.now() + 2 * 86_400_000).toISOString()
const task = (over: Record<string, unknown>) => ({ title: "Fix the door", description: "The side door sticks", assigneeIds: ["e1"], deadline: later(), difficulty: 1, ...over })
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe.skipIf(!ADMIN_URL)("deleting a location, in Postgres", () => {
    const dbName = `locations_delete_test_${Date.now()}`
    let db: Client
    let url: URL
    let Locations: typeof import("@/lib/services/location.service").LocationService
    let Tasks: typeof import("@/lib/services/task.service").TaskService

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(PLACES)
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Locations = (await import("@/lib/services/location.service")).LocationService
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

    const exists = async (id: string) => (await db.query(`SELECT 1 FROM "Location" WHERE id = $1`, [id])).rowCount === 1
    /** A second connection, for what someone else does at the same moment. */
    const another = async () => {
        const c = new Client({ connectionString: url.toString() })
        await c.connect()
        return c
    }
    /** Whether a promise is still waiting after a moment. */
    const waiting = async (p: Promise<unknown>) => {
        let settled = false
        p.then(() => { settled = true }, () => { settled = true })
        await pause(400)
        return !settled
    }

    it("says which locations a task has used, as listed and as read one at a time", async () => {
        const inUse = async (archived: boolean) => Object.fromEntries((await Locations.list(admin, { archived, page: 1, limit: 50 })).data.map(l => [l.name, l.inUse]))
        expect(await inUse(false)).toMatchObject({ "Nasr City": false, "Maadi site": false, "Dokki site": true, "Port gate": false, "Anchor yard": true })
        expect(await inUse(true)).toEqual({ "Old depot": false })
        expect((await Locations.get(admin, "acme-used")).inUse).toBe(true)
        expect((await Locations.get(admin, "port")).inUse).toBe(false)
    })

    it("deletes one no task has used, a shared one, a client's site or an archived one, with the location as it was in the audit log", async () => {
        for (const id of ["port", "acme-site", "old"]) await Locations.delete(admin, id)
        for (const id of ["port", "acme-site", "old"]) expect(await exists(id), id).toBe(false)
        const { rows } = await db.query(`SELECT "entityType", "entityId", "userId", "superAdminId", details FROM "AuditLog" WHERE action = 'DELETE_LOCATION' ORDER BY "createdAt", "entityId"`)
        expect(rows.map(r => r.entityId).sort()).toEqual(["acme-site", "old", "port"])
        const port = rows.find(r => r.entityId === "port")
        expect(port).toMatchObject({ entityType: "LOCATION", userId: "a1", superAdminId: null })
        expect(port.details).toMatchObject({ companyId: "c1", before: { name: "Port gate", clientId: null, isHq: false, latitude: 31.1849, longitude: 29.8737, radiusMeters: 80, archivedAt: null } })
        expect(rows.find(r => r.entityId === "acme-site").details.before).toMatchObject({ name: "Maadi site", clientId: "k1" })
        expect(rows.find(r => r.entityId === "old").details.before.archivedAt).not.toBeNull()
    })

    it("keeps one a task has used, and a client's HQ, saying why", async () => {
        await expect(Locations.delete(admin, "acme-used")).rejects.toMatchObject({ message: "TASK_LOCATION_IN_USE" })
        await expect(Locations.delete(admin, "acme-hq")).rejects.toMatchObject({ message: "TASK_LOCATION_IS_HQ" })
        expect(await exists("acme-used")).toBe(true)
        expect(await exists("acme-hq")).toBe(true)
        expect((await db.query(`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = 'DELETE_LOCATION' AND "entityId" IN ('acme-used', 'acme-hq')`)).rows[0].n).toBe(0)
    })

    it("is for whoever may archive locations: refused to anyone else, another company's not found, and a Super Admin's for any company", async () => {
        await expect(Locations.delete(leader, "anchor")).rejects.toMatchObject({ message: "TASK_LOCATION_FORBIDDEN" })
        await expect(Locations.delete(otherAdmin, "race-add")).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
        await expect(Locations.delete(admin, "nowhere")).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
        expect(await exists("race-add")).toBe(true)
        await Locations.delete(superAdmin, "their-shed")
        expect(await exists("their-shed")).toBe(false)
        const { rows: [entry] } = await db.query(`SELECT "userId", "superAdminId", details FROM "AuditLog" WHERE action = 'DELETE_LOCATION' AND "entityId" = 'their-shed'`)
        expect(entry).toMatchObject({ userId: null, superAdminId: "sa1", details: { companyId: "c2" } })
    })

    it("waits for a task being added at it, then keeps it for that task", async () => {
        const other = await another()
        try {
            await other.query("BEGIN")
            await other.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "locationId", "updatedAt") VALUES ('meanwhile', 'Cross the bridge', 'd', 'IN_PROGRESS', now() + interval '3 days', 'c1', 'race-add', now())`)
            const deleting = Locations.delete(admin, "race-add")
            expect(await waiting(deleting)).toBe(true)
            await other.query("COMMIT")
            await expect(deleting).rejects.toMatchObject({ message: "TASK_LOCATION_IN_USE" })
        } finally {
            await other.end()
        }
        expect(await exists("race-add")).toBe(true)
    })

    it("tells whoever deletes it second, at the same moment, that it isn't there", async () => {
        const other = await another()
        try {
            await other.query("BEGIN")
            await other.query(`DELETE FROM "Location" WHERE id = 'twice'`)
            const second = Locations.delete(admin, "twice")
            expect(await waiting(second)).toBe(true)
            await other.query("COMMIT")
            await expect(second).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
        } finally {
            await other.end()
        }
    })

    it("has a task added at it while it's being deleted wait, then told it isn't there", async () => {
        const other = await another()
        try {
            await other.query("BEGIN")
            await other.query(`DELETE FROM "Location" WHERE id = 'race-create'`)
            const adding = Tasks.create(task({ locationId: "race-create" }) as any, admin)
            expect(await waiting(adding)).toBe(true)
            await other.query("COMMIT")
            await expect(adding).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
        } finally {
            await other.end()
        }
        expect((await db.query(`SELECT count(*)::int AS n FROM "Task" WHERE title = 'Fix the door'`)).rows[0].n).toBe(0)
    })

    it("has a task moved to it while it's being deleted wait, then told it isn't there", async () => {
        const other = await another()
        try {
            await other.query("BEGIN")
            await other.query(`DELETE FROM "Location" WHERE id = 'race-edit'`)
            const moving = Tasks.updateDetails("edit-me", { id: "edit-me", locationId: "race-edit" } as any, admin)
            expect(await waiting(moving)).toBe(true)
            await other.query("COMMIT")
            await expect(moving).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
        } finally {
            await other.end()
        }
        expect((await db.query(`SELECT "locationId" FROM "Task" WHERE id = 'edit-me'`)).rows[0].locationId).toBe("anchor")
    })

    it("tells a task moved to it that it isn't there, when it's deleted between the move's check and its save", async () => {
        const original = Locations.forTask.bind(Locations)
        const spy = vi.spyOn(Locations, "forTask").mockImplementationOnce(async (...args) => {
            const found = await original(...args)
            await db.query(`DELETE FROM "Location" WHERE id = 'race-late'`)
            return found
        })
        try {
            await expect(Tasks.updateDetails("edit-me", { id: "edit-me", locationId: "race-late" } as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
        } finally {
            spy.mockRestore()
        }
        expect((await db.query(`SELECT "locationId" FROM "Task" WHERE id = 'edit-me'`)).rows[0].locationId).toBe("anchor")
    })
})
