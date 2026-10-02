import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceLocationService as Locations } from "@/lib/services/attendance-location.service"

/**
 * Work locations (ATTENDANCE_PLAN.md §8.5, §9.4): where people check in with
 * the app, who may, and the office IPs a check-in must then come from.
 * Against a real Postgres built from the migrations.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('x2', 'x2@x', 'p', 'Xena', 'Two', 'EMPLOYEE', 2026, 'x2', 'c2', NULL);
`

const OFFICE = { name: "  Head office ", latitude: 30.0444, longitude: 31.2357, radiusMeters: 150 }

describe.skipIf(!ADMIN_URL)("work locations, in Postgres", () => {
    const dbName = `locations_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
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
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const audit = async (id: string) => (await db.query(`SELECT action, details FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [id])).rows

    it("adds a place with its circle and office IPs, tidied, and audited", async () => {
        const l = await Locations.create("c1", { ...OFFICE, officeIpRanges: [" 203.0.113.7 ", "198.51.100.0/24", "203.0.113.7", ""] }, "a1")
        expect(l).toMatchObject({ name: "Head office", radiusMeters: 150, officeIpRanges: ["203.0.113.7", "198.51.100.0/24"], everyone: false, archivedAt: null, userIds: [] })
        expect((await audit(l.id))[0]).toMatchObject({ action: "CREATE_WORK_LOCATION", details: { companyId: "c1", name: "Head office", radiusMeters: 150 } })
    })

    it("refuses a nameless place, one off the map, a circle too small or too large, and addresses that don't parse", async () => {
        await expect(Locations.create("c1", { ...OFFICE, name: "  " }, "a1")).rejects.toThrow("LOCATION_NAME_REQUIRED")
        await expect(Locations.create("c1", { ...OFFICE, latitude: 91 }, "a1")).rejects.toThrow("LOCATION_INVALID_POINT")
        await expect(Locations.create("c1", { ...OFFICE, longitude: NaN }, "a1")).rejects.toThrow("LOCATION_INVALID_POINT")
        await expect(Locations.create("c1", { ...OFFICE, radiusMeters: 10 }, "a1")).rejects.toThrow("LOCATION_INVALID_RADIUS")
        await expect(Locations.create("c1", { ...OFFICE, radiusMeters: 150.5 }, "a1")).rejects.toThrow("LOCATION_INVALID_RADIUS")
        await expect(Locations.create("c1", { ...OFFICE, radiusMeters: 6000 }, "a1")).rejects.toThrow("LOCATION_INVALID_RADIUS")
        await expect(Locations.create("c1", { ...OFFICE, officeIpRanges: ["the office"] }, "a1")).rejects.toThrow("LOCATION_INVALID_IP")
        await expect(Locations.create("c1", { ...OFFICE, officeIpRanges: Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`) }, "a1")).rejects.toThrow("LOCATION_TOO_MANY_IPS")
        // The database holds the line too.
        await expect(db.query(`INSERT INTO "WorkLocation"(id, "companyId", name, latitude, longitude, "radiusMeters", "updatedAt") VALUES ('bad', 'c1', 'x', 0, 0, 5, now())`)).rejects.toThrow(/WorkLocation_radius_check/)
    })

    it("changes a place, recording only what changed", async () => {
        const l = await Locations.create("c1", { ...OFFICE, name: "Branch" }, "a1")
        const after = await Locations.update(l.id, { name: "Branch", radiusMeters: 200, officeIpRanges: ["203.0.113.9"] }, "a1")
        expect(after).toMatchObject({ name: "Branch", radiusMeters: 200, officeIpRanges: ["203.0.113.9"] })
        const [, update] = await audit(l.id)
        expect(update).toMatchObject({ action: "UPDATE_WORK_LOCATION", details: { radiusMeters: { from: 150, to: 200 }, officeIpRanges: { from: [], to: ["203.0.113.9"] } } })
        expect(update.details).not.toHaveProperty("latitude")
    })

    it("puts exactly the chosen people on a place, only the company's own, and says who came and went", async () => {
        const l = await Locations.create("c1", { ...OFFICE, name: "Site A" }, "a1")
        expect(await Locations.setPeople(l.id, ["e1", "e2", "e1"], "a1")).toEqual({ userIds: ["e1", "e2"] })
        await Locations.setPeople(l.id, ["e2"], "a1")
        await expect(Locations.setPeople(l.id, ["e2", "x2"], "a1")).rejects.toThrow("LOCATION_PEOPLE_NOT_IN_COMPANY")
        const { locations } = await Locations.list("c1")
        expect(locations.find(x => x.id === l.id)!.userIds).toEqual(["e2"])
        const assigned = (await audit(l.id)).filter(a => a.action === "ASSIGN_WORK_LOCATION").map(a => a.details)
        expect(assigned).toEqual([
            expect.objectContaining({ added: ["e1", "e2"], removed: [] }),
            expect.objectContaining({ added: [], removed: ["e1"] }),
        ])
        // Nothing changed, nothing recorded.
        await Locations.setPeople(l.id, ["e2"], "a1")
        expect((await audit(l.id)).filter(a => a.action === "ASSIGN_WORK_LOCATION")).toHaveLength(2)
    })

    it("lets a person check in where they are listed, or where everyone may, and nowhere archived", async () => {
        const listed = await Locations.create("c1", { ...OFFICE, name: "Listed" }, "a1")
        await Locations.setPeople(listed.id, ["e1"], "a1")
        const open = await Locations.create("c1", { ...OFFICE, name: "Open", everyone: true }, "a1")
        const closed = await Locations.create("c1", { ...OFFICE, name: "Closed", everyone: true }, "a1")
        await Locations.archive(closed.id, "a1")
        const names = async (userId: string) => (await Locations.forPerson("c1", userId)).map(l => l.name)
        expect(await names("e1")).toEqual(expect.arrayContaining(["Listed", "Open"]))
        expect(await names("e1")).not.toContain("Closed")
        expect(await names("e2")).not.toContain("Listed")
        expect(await names("e2")).toContain("Open")
        // Another company's open place is not theirs.
        await Locations.create("c2", { ...OFFICE, name: "Theirs", everyone: true }, "a1")
        expect(await names("e1")).not.toContain("Theirs")
        expect(open.everyone).toBe(true)
    })

    it("archives and restores, keeping who was on it; an archived place can't be changed", async () => {
        const l = await Locations.create("c1", { ...OFFICE, name: "Seasonal" }, "a1")
        await Locations.setPeople(l.id, ["e1"], "a1")
        await Locations.archive(l.id, "a1")
        await expect(Locations.archive(l.id, "a1")).rejects.toThrow("LOCATION_ARCHIVED")
        await expect(Locations.update(l.id, { radiusMeters: 300 }, "a1")).rejects.toThrow("LOCATION_ARCHIVED")
        await expect(Locations.setPeople(l.id, [], "a1")).rejects.toThrow("LOCATION_ARCHIVED")
        await Locations.restore(l.id, "a1")
        await expect(Locations.restore(l.id, "a1")).rejects.toThrow("LOCATION_NOT_ARCHIVED")
        expect((await Locations.list("c1")).locations.find(x => x.id === l.id)).toMatchObject({ archivedAt: null, userIds: ["e1"] })
        expect((await audit(l.id)).map(a => a.action)).toEqual(["CREATE_WORK_LOCATION", "ASSIGN_WORK_LOCATION", "ARCHIVE_WORK_LOCATION", "RESTORE_WORK_LOCATION"])
        await expect(Locations.update("nope", { name: "x" }, "a1")).rejects.toThrow("LOCATION_NOT_FOUND")
    })

    it("lists the company's people at work for the picker, and no one else's", async () => {
        const { people } = await Locations.list("c1")
        expect(people.map(p => p.id)).toEqual(expect.arrayContaining(["a1", "e1", "e2"]))
        expect(people.map(p => p.id)).not.toContain("x2")
        expect(people.find(p => p.id === "e1")).toEqual({ id: "e1", name: "Ehab One" })
    })
})
