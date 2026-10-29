import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { encodeGrants } from "@/lib/permissions/grants"

/**
 * The places tasks happen at (CLIENTS_PLAN.md §2, step 1), against a real
 * Postgres: the migration that gives every client its HQ, and
 * LocationService and ClientService reading and writing what the database
 * accepts. The database is built from every migration in order, with
 * clients from before locations existed.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const LOCATIONS = "20261109000000_locations"
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
// Clients from before locations: one picked from the place search (its map
// link carries the pin, in either form the app has written), one typed.
const CLIENTS_BEFORE = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "locationLink", "updatedAt") VALUES
 ('k1', 'c1', 'Acme', 'Mona', '0100', 'Nasr City, Cairo', 'https://www.google.com/maps?q=30.0561,31.3301', now()),
 ('k2', 'c1', 'Beta', 'Omar', '0101', 'Smouha', 'https://www.google.com/maps/search/?api=1&query=31.2156,29.9553', now()),
 ('k3', 'c2', 'Gamma', 'Sara', '0102', 'Typed by hand', NULL, now());
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) } as any
const leader = { user: withGrants({ id: "l1", role: "TEAM_LEADER", companyId: "c1" }) } as any
const employee = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" }) } as any
const otherAdmin = { user: withGrants({ id: "a2", role: "ADMIN", companyId: "c2" }) } as any
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } } as any

const PIN = { latitude: 30.0444, longitude: 31.2357 }

describe.skipIf(!ADMIN_URL)("locations, in Postgres", () => {
    const dbName = `locations_test_${Date.now()}`
    let db: Client
    let Locations: typeof import("@/lib/services/location.service").LocationService
    let Clients: typeof import("@/lib/services/client.service").ClientService

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
            if (m === LOCATIONS) await db.query(CLIENTS_BEFORE)
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Locations = (await import("@/lib/services/location.service")).LocationService
        Clients = (await import("@/lib/services/client.service")).ClientService
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    const hqOf = async (clientId: string) => (await db.query(`SELECT name, latitude, longitude FROM "Location" WHERE "clientId" = $1 AND "isHq"`, [clientId])).rows

    describe("the migration", () => {
        it("makes each client's one location its HQ, with the pin from its map link, or none for a typed one", async () => {
            expect(await hqOf("k1")).toEqual([{ name: "Nasr City, Cairo", latitude: 30.0561, longitude: 31.3301 }])
            expect(await hqOf("k2")).toEqual([{ name: "Smouha", latitude: 31.2156, longitude: 29.9553 }])
            // "Needs a pin": no task can use it until someone places one.
            expect(await hqOf("k3")).toEqual([{ name: "Typed by hand", latitude: null, longitude: null }])
        })

        it("holds what the schema can't say: one HQ, a whole pin, a radius in range, an HQ a client's and in use", async () => {
            const add = (values: string) => db.query(`INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "radiusMeters", "archivedAt", "updatedAt") VALUES ${values}`)
            await expect(add(`('x1', 'c1', 'k1', 'Second HQ', true, 30, 31, NULL, NULL, now())`)).rejects.toThrow(/Location_one_hq_per_client/)
            await expect(add(`('x2', 'c1', 'k1', 'Half a pin', false, 30, NULL, NULL, NULL, now())`)).rejects.toThrow(/Location_pin_whole/)
            await expect(add(`('x3', 'c1', 'k1', 'Too close', false, 30, 31, 5, NULL, now())`)).rejects.toThrow(/Location_radius_range/)
            await expect(add(`('x4', 'c1', NULL, 'Shared HQ', true, 30, 31, NULL, NULL, now())`)).rejects.toThrow(/Location_hq_of_client/)
            await expect(db.query(`UPDATE "Location" SET "archivedAt" = now() WHERE "clientId" = 'k1' AND "isHq"`)).rejects.toThrow(/Location_hq_of_client/)
            await expect(add(`('x5', 'c1', NULL, 'Off the earth', false, 91, 31, NULL, NULL, now())`)).rejects.toThrow(/Location_pin_on_earth/)
        })

        it("leaves Row Level Security on, as on every table", async () => {
            expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'Location'`)).rows).toEqual([{ relrowsecurity: true }])
        })
    })

    describe("LocationService", () => {
        it("adds a client's location and a shared one, for whoever may add them", async () => {
            const branch = await Locations.create(leader, { name: "Maadi branch", clientId: "k1", ...PIN, radiusMeters: 150 })
            expect(branch).toMatchObject({ name: "Maadi branch", isHq: false, radiusMeters: 150, client: { id: "k1", name: "Acme" } })
            const shared = await Locations.create(admin, { name: "Port warehouse", ...PIN })
            expect(shared).toMatchObject({ name: "Port warehouse", isHq: false, radiusMeters: null, client: null })
            await expect(Locations.create(employee, { name: "Nope", ...PIN })).rejects.toMatchObject({ message: "TASK_LOCATION_FORBIDDEN" })
            // Another company's client is not found, never "not allowed".
            await expect(Locations.create(otherAdmin, { name: "Theirs", clientId: "k1", ...PIN })).rejects.toMatchObject({ message: "CLIENT_NOT_FOUND" })
        })

        it("lists by client, each one's HQ first and the shared ones last, and finds one by its client's name", async () => {
            const { data } = await Locations.list(admin, { page: 1, limit: 50 })
            expect(data.map(l => `${l.client?.name ?? "-"} ${l.name}${l.isHq ? " (HQ)" : ""}`)).toEqual([
                "Acme Nasr City, Cairo (HQ)", "Acme Maadi branch", "Beta Smouha (HQ)", "- Port warehouse",
            ])
            expect((await Locations.list(admin, { search: "beta", page: 1, limit: 50 })).data.map(l => l.name)).toEqual(["Smouha"])
            expect((await Locations.list(admin, { clientId: "shared", page: 1, limit: 50 })).data.map(l => l.name)).toEqual(["Port warehouse"])
            // Another company's aren't listed; one with no permission is refused.
            expect((await Locations.list(otherAdmin, { page: 1, limit: 50 })).data.map(l => l.name)).toEqual(["Typed by hand"])
            await expect(Locations.list(employee, { page: 1, limit: 50 })).rejects.toMatchObject({ message: "TASK_LOCATION_FORBIDDEN" })
        })

        it("changes a location's pin and radius for whoever manages them, and its client's own location with its HQ's", async () => {
            const [hq] = (await Locations.list(admin, { clientId: "k1", page: 1, limit: 5 })).data
            await expect(Locations.update(leader, { id: hq.id, radiusMeters: 200 })).rejects.toMatchObject({ message: "TASK_LOCATION_FORBIDDEN" })
            await Locations.update(admin, { id: hq.id, name: "Head office", latitude: 30.1, longitude: 31.4, radiusMeters: 200 })
            const { rows: [client] } = await db.query(`SELECT "locationName", "locationLink" FROM "Client" WHERE id = 'k1'`)
            expect(client).toEqual({ locationName: "Head office", locationLink: "https://www.google.com/maps/search/?api=1&query=30.1,31.4" })
            // Back to the default radius.
            expect(await Locations.update(admin, { id: hq.id, radiusMeters: null })).toMatchObject({ radiusMeters: null })
        })

        it("makes another location the HQ in place of the one there was, which can't be archived until then", async () => {
            const [hq, branch] = (await Locations.list(admin, { clientId: "k1", page: 1, limit: 5 })).data
            await expect(Locations.update(admin, { id: hq.id, archived: true })).rejects.toMatchObject({ message: "TASK_LOCATION_IS_HQ" })
            await Locations.update(admin, { id: branch.id, hq: true })
            expect((await hqOf("k1")).map(l => l.name)).toEqual(["Maadi branch"])
            expect((await db.query(`SELECT "locationName" FROM "Client" WHERE id = 'k1'`)).rows[0].locationName).toBe("Maadi branch")
            const archived = await Locations.update(admin, { id: hq.id, archived: true })
            expect(archived.archivedAt).not.toBeNull()
            expect((await Locations.list(admin, { clientId: "k1", page: 1, limit: 5 })).data.map(l => l.name)).toEqual(["Maadi branch"])
            expect((await Locations.list(admin, { clientId: "k1", archived: true, page: 1, limit: 5 })).data.map(l => l.name)).toEqual(["Head office"])
            // An archived one is restored before it can be the HQ again.
            await expect(Locations.update(admin, { id: hq.id, hq: true })).rejects.toMatchObject({ message: "TASK_LOCATION_ARCHIVED" })
            expect((await Locations.update(admin, { id: hq.id, archived: false })).archivedAt).toBeNull()
        })

        it("never makes a shared location an HQ", async () => {
            const [shared] = (await Locations.list(admin, { clientId: "shared", page: 1, limit: 5 })).data
            await expect(Locations.update(admin, { id: shared.id, hq: true })).rejects.toMatchObject({ message: "TASK_LOCATION_SHARED" })
        })

        it("hides another company's location, as not found", async () => {
            const [theirs] = (await Locations.list(otherAdmin, { page: 1, limit: 5 })).data
            await expect(Locations.get(admin, theirs.id)).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
            await expect(Locations.update(admin, { id: theirs.id, radiusMeters: 100 })).rejects.toMatchObject({ message: "TASK_LOCATION_NOT_FOUND" })
        })

        it("has a Super Admin say which company a shared location is for, and see every company's until they pick one", async () => {
            await expect(Locations.create(superAdmin, { name: "Airport gate", ...PIN })).rejects.toMatchObject({ message: "COMPANY_SELECTION_REQUIRED" })
            const added = await Locations.create(superAdmin, { name: "Airport gate", companyId: "c2", ...PIN })
            expect(added).toMatchObject({ name: "Airport gate", client: null, company: { name: expect.any(String) } })
            const { rows: [row] } = await db.query(`SELECT "companyId", "createdById" FROM "Location" WHERE id = $1`, [added.id])
            expect(row).toEqual({ companyId: "c2", createdById: null })
            const { rows: [audit] } = await db.query(`SELECT "userId", "superAdminId" FROM "AuditLog" WHERE "entityId" = $1`, [added.id])
            expect(audit).toEqual({ userId: null, superAdminId: "sa1" })
            const every = (await Locations.list(superAdmin, { page: 1, limit: 100 })).data.map(l => l.company.name)
            expect(new Set(every).size).toBe(2)
            const one = (await Locations.list(superAdmin, { companyId: "c2", page: 1, limit: 100 })).data
            expect(one.length).toBeGreaterThan(0)
            expect(new Set(one.map(l => l.company.name)).size).toBe(1)
            expect(one.map(l => l.name)).toContain("Airport gate")
        })

        it("makes the first location of a client made before locations, without an HQ, its HQ, once when two are added at once", async () => {
            // As the release before adds a client while this waits for review.
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('k4', 'c1', 'Delta', 'Nour', '0103', 'Typed later', now())`)
            const [one, two] = await Promise.all([
                Locations.create(admin, { name: "Office", clientId: "k4", ...PIN }),
                Locations.create(leader, { name: "Store", clientId: "k4", ...PIN }),
            ])
            expect([one.isHq, two.isHq].sort()).toEqual([false, true])
            const { rows: [client] } = await db.query(`SELECT "locationName" FROM "Client" WHERE id = 'k4'`)
            expect(client.locationName).toBe(one.isHq ? "Office" : "Store")
        })
    })

    describe("a client's HQ", () => {
        it("is made with the client, and its own location fields follow it", async () => {
            const client = await Clients.create({ name: "Epsilon", ownerName: "Hana", mobileNumber: "0104", hq: { name: "Luxor office", ...PIN, radiusMeters: 120 } }, admin)
            expect(await hqOf(client.id)).toEqual([{ name: "Luxor office", ...PIN }])
            expect(client).toMatchObject({ locationName: "Luxor office", locationLink: "https://www.google.com/maps/search/?api=1&query=30.0444,31.2357" })
        })

        it("changes when the client is edited, or is made then for a client without one", async () => {
            const [epsilon] = (await db.query(`SELECT id FROM "Client" WHERE name = 'Epsilon'`)).rows
            await Clients.update({ id: epsilon.id, hq: { name: "Luxor HQ", latitude: 25.7, longitude: 32.6 } }, admin)
            expect(await hqOf(epsilon.id)).toEqual([{ name: "Luxor HQ", latitude: 25.7, longitude: 32.6 }])
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('k5', 'c1', 'Zeta', 'Rana', '0105', 'Typed later', now())`)
            await Clients.update({ id: "k5", hq: { name: "Aswan", latitude: 24.1, longitude: 32.9 } }, admin)
            expect(await hqOf("k5")).toEqual([{ name: "Aswan", latitude: 24.1, longitude: 32.9 }])
        })

        it("is changed only by whoever may manage locations, though whoever manages clients edits the rest, and gives one to a client without one", async () => {
            const clerk = { user: { id: "e1", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "clients.view": "COMPANY", "clients.manage": "COMPANY" }) } } as any
            const [epsilon] = (await db.query(`SELECT id FROM "Client" WHERE name = 'Epsilon'`)).rows
            const asItIs = { name: "Luxor HQ", latitude: 25.7, longitude: 32.6 }
            await expect(Clients.update({ id: epsilon.id, ownerName: "Hala", hq: { ...asItIs, name: "Moved" } }, clerk)).rejects.toMatchObject({ message: "TASK_LOCATION_FORBIDDEN" })
            await expect(Clients.update({ id: epsilon.id, hq: { ...asItIs, radiusMeters: 500 } }, clerk)).rejects.toMatchObject({ message: "TASK_LOCATION_FORBIDDEN" })
            expect(await hqOf(epsilon.id)).toEqual([asItIs])
            expect((await db.query(`SELECT "ownerName" FROM "Client" WHERE id = $1`, [epsilon.id])).rows[0].ownerName).toBe("Hana")

            await Clients.update({ id: epsilon.id, ownerName: "Hala", hq: asItIs }, clerk)
            expect((await db.query(`SELECT "ownerName" FROM "Client" WHERE id = $1`, [epsilon.id])).rows[0].ownerName).toBe("Hala")
            expect(await hqOf(epsilon.id)).toEqual([asItIs])

            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('k6', 'c1', 'Eta', 'Nour', '0106', 'Typed later', now())`)
            await Clients.update({ id: "k6", hq: { name: "Qena", latitude: 26.2, longitude: 32.7 } }, clerk)
            expect(await hqOf("k6")).toEqual([{ name: "Qena", latitude: 26.2, longitude: 32.7 }])
        })

        it("goes with its client, as do the client's other locations", async () => {
            await Clients.delete("k5", admin)
            expect((await db.query(`SELECT count(*)::int AS n FROM "Location" WHERE "clientId" = 'k5'`)).rows[0].n).toBe(0)
        })
    })
})
