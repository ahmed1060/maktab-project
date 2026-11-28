import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { encodeGrants } from "@/lib/permissions/grants"

/**
 * A location's check radius, only in its own form (LATER_CHANGES_PLAN.md
 * §7.22; DESIGN.md §5.3, A place on the map), against a real Postgres: a
 * location's own radius only to whoever may edit locations, the default,
 * the system's distance, only to whoever may add or edit them, and a
 * client's HQ keeping its radius when the client is edited.
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
 ('l1', 'l1@x', 'p', 'Laila', 'One', 'TEAM_LEADER', 2026, 'l1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`
// A shared place with a radius of its own and one with none, and a client with its HQ.
const PLACES = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('k1', 'c1', 'Acme', 'Mona', '0100', 'Nasr City', now());
DELETE FROM "Location";
INSERT INTO "Location"(id, "companyId", "clientId", name, "isHq", latitude, longitude, "radiusMeters", "archivedAt", "updatedAt") VALUES
 ('acme-hq', 'c1', 'k1', 'Nasr City', true, 30.0444, 31.2357, 150, NULL, now()),
 ('port', 'c1', NULL, 'Port gate', false, 31.1849, 29.8737, 80, NULL, now()),
 ('yard', 'c1', NULL, 'Yard', false, 30.1, 31.1, NULL, NULL, now());
INSERT INTO "SystemSettings"(id, "locationVerifyRadiusMeters", "updatedAt") VALUES ('default', 30, now())
 ON CONFLICT (id) DO UPDATE SET "locationVerifyRadiusMeters" = 30;
`

// An Admin may edit locations; a Team Leader may add them, not edit them;
// someone may only see them; and the Super Admin.
const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) } as any
const leader = { user: withGrants({ id: "l1", role: "TEAM_LEADER", companyId: "c1" }) } as any
const viewer = { user: { id: "e1", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "locations.view": "COMPANY" }) } } as any
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } } as any

const PIN = { latitude: 30.0444, longitude: 31.2357 }

describe.skipIf(!ADMIN_URL)("a location's check radius, in Postgres", () => {
    const dbName = `location_radius_test_${Date.now()}`
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
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(PLACES)
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

    const listed = async (session: any) => (await Locations.list(session, { page: 1, limit: 50 }))
    const byName = (rows: any[]) => Object.fromEntries(rows.map(l => [l.name, l]))

    it("gives a location's own radius only to whoever may edit locations", async () => {
        const forAdmin = byName((await listed(admin)).data)
        expect(forAdmin["Port gate"].radiusMeters).toBe(80)
        expect(forAdmin["Yard"].radiusMeters).toBeNull()
        expect((await Locations.get(admin, "port")).radiusMeters).toBe(80)
        expect(byName((await Locations.list(superAdmin, { page: 1, limit: 50 })).data)["Port gate"].radiusMeters).toBe(80)
        for (const [who, session] of [["a Team Leader, who may add one", leader], ["someone who may only see them", viewer]] as const) {
            for (const row of (await listed(session)).data) expect("radiusMeters" in row, `${who}: ${row.name}`).toBe(false)
            expect("radiusMeters" in (await Locations.get(session, "port")), who).toBe(false)
        }
    })

    it("gives the default, the system's distance as it is now, only to whoever may add or edit locations", async () => {
        expect((await listed(admin)).defaultRadiusMeters).toBe(30)
        expect((await listed(leader)).defaultRadiusMeters).toBe(30)
        expect((await Locations.pickable(leader, {})).defaultRadiusMeters).toBe(30)
        expect((await Locations.list(superAdmin, { page: 1, limit: 50 })).defaultRadiusMeters).toBe(30)
        expect("defaultRadiusMeters" in (await listed(viewer))).toBe(false)
        expect("defaultRadiusMeters" in (await Locations.pickable(viewer, {}))).toBe(false)
        await db.query(`UPDATE "SystemSettings" SET "locationVerifyRadiusMeters" = 45`)
        expect((await listed(admin)).defaultRadiusMeters).toBe(45)
        await db.query(`UPDATE "SystemSettings" SET "locationVerifyRadiusMeters" = 30`)
    })

    it("keeps a client's HQ radius when the client is edited without one, and gives a new client's HQ the default", async () => {
        await Clients.update({ id: "k1", hq: { name: "Head office", ...PIN } } as any, admin)
        expect((await db.query(`SELECT name, "radiusMeters" FROM "Location" WHERE id = 'acme-hq'`)).rows[0]).toEqual({ name: "Head office", radiusMeters: 150 })
        const made = await Clients.create({ name: "Beta", nameAr: "بيتا", ownerName: "Omar", ownerNameAr: "عمر", mobileNumber: "0101", hq: { name: "Smouha", ...PIN } } as any, admin)
        expect((await db.query(`SELECT "radiusMeters" FROM "Location" WHERE "clientId" = $1 AND "isHq"`, [made.id])).rows[0].radiusMeters).toBeNull()
    })
})
