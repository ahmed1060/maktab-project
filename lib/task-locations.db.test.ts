import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Tasks done at locations (CLIENTS_PLAN.md §2.3, §2.5, §3.1, step 2),
 * against a real Postgres: a task is created and edited with a client and a
 * location, each checked, and the employee's location check measures from
 * the location's pin, within its own radius.
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
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`

// Acme's HQ has its pin and a radius of its own; Beta's HQ has no pin yet.
// A shared place, an archived one, and another company's.
const PLACES = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('k1', 'c1', 'Acme', 'Mona', '0100', 'Nasr City', now()),
 ('k2', 'c1', 'Beta', 'Omar', '0101', 'Smouha', now()),
 ('k9', 'c2', 'Theirs', 'Sara', '0102', 'Far away', now());
DELETE FROM "Location";
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "radiusMeters", "archivedAt", "updatedAt") VALUES
 ('acme-hq', 'c1', 'k1', 'Nasr City', true, 30.0444, 31.2357, 150, NULL, now()),
 ('acme-site', 'c1', 'k1', 'Maadi site', false, 29.9602, 31.2569, NULL, NULL, now()),
 ('beta-hq', 'c1', 'k2', 'Smouha', true, NULL, NULL, NULL, NULL, now()),
 ('port', 'c1', NULL, 'Port gate', false, 31.1849, 29.8737, NULL, NULL, now()),
 ('old', 'c1', NULL, 'Old depot', false, 30.1, 31.1, NULL, now(), now()),
 ('theirs', 'c2', 'k9', 'Far away', true, 25.7, 32.6, NULL, NULL, now());
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any
const employee = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" }) } as any

const later = () => new Date(Date.now() + 2 * 86_400_000).toISOString()
const task = (over: Record<string, unknown>) => ({ title: "Fix the door", description: "The side door sticks", assigneeIds: ["e1"], deadline: later(), difficulty: 1, ...over })
/** Where the employee says they are: about 100 m north of Acme's HQ, to within 10 m. */
const NORTH_100M = JSON.stringify({ latitude: 30.0453, longitude: 31.2357, accuracy: 10 })

describe.skipIf(!ADMIN_URL)("tasks at locations, in Postgres", () => {
    const dbName = `task_locations_test_${Date.now()}`
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
        await db.query(PLACES)
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

    const row = async (id: string) => (await db.query(`SELECT "clientId", "locationId", location, comments FROM "Task" WHERE id = $1`, [id])).rows[0]

    describe("creating a task", () => {
        it("needs a location, and keeps its name and map link as the task's text", async () => {
            await expect(Tasks.create(task({ clientId: "k1" }) as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_REQUIRED" })
            const made = await Tasks.create(task({ clientId: "k1", locationId: "acme-site" }) as any, admin)
            expect(await row(made.id)).toMatchObject({
                clientId: "k1",
                locationId: "acme-site",
                location: JSON.stringify({ name: "Acme - Maadi site", link: "https://www.google.com/maps/search/?api=1&query=29.9602,31.2569" }),
            })
        })

        it("takes a shared location with or without a client, but no other client's", async () => {
            expect((await row((await Tasks.create(task({ locationId: "port" }) as any, admin)).id)).locationId).toBe("port")
            expect((await row((await Tasks.create(task({ clientId: "k2", locationId: "port" }) as any, admin)).id)).locationId).toBe("port")
            await expect(Tasks.create(task({ locationId: "acme-hq" }) as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_OTHER_CLIENT" })
            await expect(Tasks.create(task({ clientId: "k2", locationId: "acme-hq" }) as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_OTHER_CLIENT" })
        })

        it("refuses a location with no pin, an archived one, and another company's, and another company's client", async () => {
            await expect(Tasks.create(task({ clientId: "k2", locationId: "beta-hq" }) as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_NEEDS_PIN" })
            await expect(Tasks.create(task({ locationId: "old" }) as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_ARCHIVED" })
            await expect(Tasks.create(task({ locationId: "theirs" }) as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
            await expect(Tasks.create(task({ clientId: "k9", locationId: "port" }) as any, admin)).rejects.toMatchObject({ message: "CROSS_COMPANY_CLIENT_FORBIDDEN" })
            await expect(Tasks.create(task({ locationId: "nowhere" }) as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
        })
    })

    describe("editing a task", () => {
        it("changes its client and location together, and records both by name", async () => {
            const made = await Tasks.create(task({ clientId: "k1", locationId: "acme-hq" }) as any, admin)
            await Tasks.updateDetails(made.id, { id: made.id, clientId: null, locationId: "port" } as any, admin)
            const after = await row(made.id)
            expect(after).toMatchObject({ clientId: null, locationId: "port" })
            expect(JSON.parse(after.location).name).toBe("Port gate")
            expect(after.comments.at(-1)).toMatchObject({ type: "TASK_EDITED", changes: { client: { from: "Acme", to: null }, location: { from: "Acme - Nasr City", to: "Port gate" } } })
        })

        it("won't leave a task at the client's location it no longer has", async () => {
            const made = await Tasks.create(task({ clientId: "k1", locationId: "acme-hq" }) as any, admin)
            await expect(Tasks.updateDetails(made.id, { id: made.id, clientId: "k2" } as any, admin)).rejects.toMatchObject({ message: "TASK_LOCATION_OTHER_CLIENT" })
            // A shared one stays with any client.
            const shared = await Tasks.create(task({ clientId: "k1", locationId: "port" }) as any, admin)
            await Tasks.updateDetails(shared.id, { id: shared.id, clientId: "k2" } as any, admin)
            expect(await row(shared.id)).toMatchObject({ clientId: "k2", locationId: "port" })
        })

        it("leaves its location alone when only its title changes, though that location is archived since", async () => {
            const made = await Tasks.create(task({ locationId: "port" }) as any, admin)
            await db.query(`UPDATE "Location" SET "archivedAt" = now() WHERE id = 'port'`)
            try {
                await Tasks.updateDetails(made.id, { id: made.id, title: "Fix the side door", locationId: "port" } as any, admin)
                expect(await row(made.id)).toMatchObject({ locationId: "port" })
            } finally {
                await db.query(`UPDATE "Location" SET "archivedAt" = NULL WHERE id = 'port'`)
            }
        })
    })

    describe("the employee's location check", () => {
        const check = async (id: string) => {
            await Tasks.submit(id, "e1", employee, { isDraft: true, location: NORTH_100M })
            return (await row(id)).comments.filter((c: any) => c.type === "LOCATION_ADDED").at(-1).verificationStatus
        }

        it("measures from the location's pin, within its own radius, or the system's 70 m without one", async () => {
            // 100 m out, within 10 m: inside 150 m, outside 70 m.
            expect(await check((await Tasks.create(task({ clientId: "k1", locationId: "acme-hq" }) as any, admin)).id)).toBe("CORRECT")
            await db.query(`UPDATE "Location" SET "radiusMeters" = NULL WHERE id = 'acme-hq'`)
            expect(await check((await Tasks.create(task({ clientId: "k1", locationId: "acme-hq" }) as any, admin)).id)).toBe("WRONG")
            await db.query(`UPDATE "Location" SET "radiusMeters" = 150 WHERE id = 'acme-hq'`)
        })

        it("uses a pin corrected after the task was made", async () => {
            const made = await Tasks.create(task({ clientId: "k1", locationId: "acme-site" }) as any, admin)
            // Maadi is 10 km away; the pin is corrected to where the work is.
            await db.query(`UPDATE "Location" SET latitude = 30.0444, longitude = 31.2357, "radiusMeters" = 150 WHERE id = 'acme-site'`)
            expect(await check(made.id)).toBe("CORRECT")
        })

        it("still measures a task from before locations from its typed location's coordinates", async () => {
            await db.query(`INSERT INTO "Task"(id, title, description, status, deadline, "companyId", location, "updatedAt") VALUES ('typed', 'Old one', 'From before locations', 'IN_PROGRESS', now() + interval '2 days', 'c1', '{"name":"Nasr City","link":"https://www.google.com/maps?q=30.0444,31.2357"}', now())`)
            await db.query(`INSERT INTO "_MultipleAssignees"("A", "B") VALUES ('typed', 'e1')`)
            expect(await check("typed")).toBe("WRONG")
        })
    })

    it("offers a task's picker its client's locations in use, the HQ first, then the shared ones", async () => {
        const { LocationService } = await import("@/lib/services/location.service")
        const names = (list: { name: string; isHq: boolean; needsPin: boolean }[]) => list.map(l => `${l.name}${l.isHq ? " (HQ)" : ""}${l.needsPin ? " (needs a pin)" : ""}`)
        const forAcme = await LocationService.pickable(admin, { clientId: "k1" })
        expect(names(forAcme.client)).toEqual(["Nasr City (HQ)", "Maadi site"])
        expect(names(forAcme.shared)).toEqual(["Port gate"])
        expect(names((await LocationService.pickable(admin, { clientId: "k2" })).client)).toEqual(["Smouha (HQ) (needs a pin)"])
        expect((await LocationService.pickable(admin, {})).client).toEqual([])
        await expect(LocationService.pickable(admin, { clientId: "k9" })).rejects.toMatchObject({ message: "CLIENT_NOT_FOUND" })
        await expect(LocationService.pickable(employee, {})).rejects.toMatchObject({ message: "TASK_LOCATION_FORBIDDEN" })
    })

    describe("the bulk upload", () => {
        const titled = (title: string, over: Record<string, unknown>) => task({ title, ...over })

        it("creates each task at the location picked for it, with its name and map link as its text", async () => {
            await Tasks.bulkCreate([titled("Bulk at Acme", { clientId: "k1", locationId: "acme-hq" }), titled("Bulk at the port", { locationId: "port" })], admin)
            const { rows } = await db.query(`SELECT title, "clientId", "locationId", location FROM "Task" WHERE title LIKE 'Bulk at %' ORDER BY title`)
            expect(rows.map(r => [r.title, r.clientId, r.locationId, JSON.parse(r.location).name])).toEqual([
                ["Bulk at Acme", "k1", "acme-hq", "Acme - Nasr City"],
                ["Bulk at the port", null, "port", "Port gate"],
            ])
        })

        it("refuses the whole upload, naming the task, when one has no location or another client's", async () => {
            await expect(Tasks.bulkCreate([titled("Fine one", { locationId: "port" }), titled("No place", {})], admin)).rejects.toMatchObject({ message: "TASK_LOCATION_REQUIRED: No place" })
            await expect(Tasks.bulkCreate([titled("Wrong place", { clientId: "k2", locationId: "acme-hq" })], admin)).rejects.toMatchObject({ message: "TASK_LOCATION_OTHER_CLIENT: Wrong place" })
            await expect(Tasks.bulkCreate([titled("Unpinned", { clientId: "k2", locationId: "beta-hq" })], admin)).rejects.toMatchObject({ message: "TASK_LOCATION_NEEDS_PIN: Unpinned" })
            expect((await db.query(`SELECT count(*)::int AS n FROM "Task" WHERE title IN ('Fine one', 'No place', 'Wrong place', 'Unpinned')`)).rows[0].n).toBe(0)
        })

        it("lists every location in use for the review screen, with its client", async () => {
            const { LocationService } = await import("@/lib/services/location.service")
            const { locations } = await LocationService.pickableAll(admin, {})
            expect(locations.map(l => [l.id, l.clientId, l.needsPin]).sort()).toEqual([
                ["acme-hq", "k1", false], ["acme-site", "k1", false], ["beta-hq", "k2", true], ["port", null, false],
            ])
        })

        it("lists them all, however many, as the template does: a row naming one is never refused for being past a cap", async () => {
            const { LocationService } = await import("@/lib/services/location.service")
            await db.query(`INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "radiusMeters", "updatedAt")
                SELECT 'many-' || n, 'c1', NULL, 'Site ' || n, false, 30.0, 31.0, 100, now() FROM generate_series(1, 2001) AS n`)
            try {
                const { locations } = await LocationService.pickableAll(admin, {})
                expect(locations).toHaveLength(4 + 2001)
            } finally {
                await db.query(`DELETE FROM "Location" WHERE id LIKE 'many-%'`)
            }
        })
    })

    it("keeps the client and location on a transferred task's copy", async () => {
        const made = await Tasks.create(task({ clientId: "k1", locationId: "acme-hq" }) as any, admin)
        await db.query(`UPDATE "Task" SET status = 'IN_PROGRESS' WHERE id = $1`, [made.id])
        await Tasks.transfer(made.id, admin, { newAssigneeIds: ["e2"] })
        const { rows } = await db.query(`SELECT "clientId", "locationId" FROM "Task" WHERE title = 'Fix the door (Transfer Copy)'`)
        expect(rows).toEqual([{ clientId: "k1", locationId: "acme-hq" }])
    })

    it("refuses another company's location from a bulk upload, as creating a task does", async () => {
        await expect(Tasks.bulkCreate([task({ title: "Bulk at theirs", locationId: "theirs" })], admin)).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND: Bulk at theirs" })
        expect((await db.query(`SELECT count(*)::int AS n FROM "Task" WHERE title = 'Bulk at theirs'`)).rows[0].n).toBe(0)
    })

    it("lists every location for the Tasks and Costs pages' filter, the archived ones too, marked", async () => {
        const { LocationService } = await import("@/lib/services/location.service")
        const { locations } = await LocationService.forFilters(admin, {})
        expect(locations.map(l => [l.id, l.clientId, l.archived]).sort()).toEqual([
            ["acme-hq", "k1", false], ["acme-site", "k1", false], ["beta-hq", "k2", false], ["old", null, true], ["port", null, false],
        ])
        await expect(LocationService.forFilters(employee, {})).rejects.toThrow()
    })

    describe("an archived client (CLIENTS_PLAN.md §4.3)", () => {
        let Clients: typeof import("@/lib/services/client.service").ClientService

        it("is what deleting one with tasks does; one with none is deleted", async () => {
            Clients = (await import("@/lib/services/client.service")).ClientService
            const theirs = await Tasks.create(task({ title: "Beta's job", clientId: "k2", locationId: "port" }) as any, admin)
            expect(await Clients.delete("k2", admin)).toMatchObject({ archived: true })
            expect((await db.query(`SELECT "archivedAt" IS NOT NULL AS archived FROM "Client" WHERE id = 'k2'`)).rows[0].archived).toBe(true)
            expect((await row(theirs.id)).clientId).toBe("k2")
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('k7', 'c1', 'Unused', 'Rami', '0107', 'Nowhere', now())`)
            expect(await Clients.delete("k7", admin)).toMatchObject({ archived: false })
            expect((await db.query(`SELECT count(*)::int AS n FROM "Client" WHERE id = 'k7'`)).rows[0].n).toBe(0)
        })

        it("is what's done when archiving was asked for, though nothing uses it any more", async () => {
            // The list offered Archive while it had a task; the task went before Archive was confirmed.
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('k8', 'c1', 'Once used', 'Hala', '0108', 'Nowhere', now())`)
            expect(await Clients.delete("k8", admin, { archive: true })).toMatchObject({ archived: true })
            expect((await db.query(`SELECT "archivedAt" IS NOT NULL AS archived FROM "Client" WHERE id = 'k8'`)).rows[0]).toEqual({ archived: true })
        })

        it("takes no new task, nor an existing one moved to it, nor one uploaded for it", async () => {
            await expect(Tasks.create(task({ clientId: "k2", locationId: "port" }) as any, admin)).rejects.toMatchObject({ message: "CLIENT_ARCHIVED" })
            const other = await Tasks.create(task({ locationId: "port" }) as any, admin)
            await expect(Tasks.updateDetails(other.id, { id: other.id, clientId: "k2" } as any, admin)).rejects.toMatchObject({ message: "CLIENT_ARCHIVED" })
            await expect(Tasks.bulkCreate([task({ title: "For an archived one", clientId: "k2", locationId: "port" })], admin)).rejects.toMatchObject({ message: "CLIENT_ARCHIVED: For an archived one" })
        })

        it("keeps its own tasks editable, and isn't offered to add a record to", async () => {
            const { rows: [mine] } = await db.query(`SELECT id FROM "Task" WHERE title = 'Beta''s job'`)
            await Tasks.updateDetails(mine.id, { id: mine.id, title: "Beta's old job" } as any, admin)
            expect((await db.query(`SELECT title, "clientId" FROM "Task" WHERE id = $1`, [mine.id])).rows[0]).toEqual({ title: "Beta's old job", clientId: "k2" })
            const { RecordService } = await import("@/lib/services/record.service")
            const recordAdmin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) } as any
            expect((await RecordService.clients(recordAdmin, null, null)).clients.map(c => c.name)).not.toContain("Beta")
        })

        it("is in use again once restored", async () => {
            await Clients.restore("k2", admin)
            expect((await row((await Tasks.create(task({ clientId: "k2", locationId: "port" }) as any, admin)).id)).clientId).toBe("k2")
        })
    })
})
