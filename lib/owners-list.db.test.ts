import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"

/**
 * The Owners list (LATER_CHANGES_PLAN.md §7.3, step 3c, PR 429), against a
 * real Postgres: the list's question finds the owners now, and the
 * Employees list's leaves them out, an owner taken off back on it; and each
 * owner is sent since when they're one, and their company's month now.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

// Made-up people, in two made-up companies a day apart in time zones.
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt", timezone) VALUES ('c1', 'Made Up', now(), 'Africa/Cairo'), ('c2', 'Made Up Too', now(), 'Pacific/Kiritimati');
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('a2', 'a2@x', 'p', 'Adel', 'One', 'ADMIN', 2026, 'a2', 'c1'),
 ('a3', 'a3@x', 'p', 'Aya', 'One', 'ADMIN', 2026, 'a3', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('b1', 'b1@x', 'p', 'Basma', 'Two', 'ADMIN', 2026, 'b1', 'c2');
`

const ROLES = ["ADMIN", "TEAM_LEADER", "EMPLOYEE", "SUPER_ADMIN"] as const
const STATUSES = ["ACTIVE", "OFFLINE", "SUSPENDED", "ARCHIVED", "DELETED"] as const
const by = { userId: "a1", superAdminId: null }

describe.skipIf(!ADMIN_URL)("the Owners list, in Postgres", () => {
    const dbName = `owners_list_test_${Date.now()}`
    let db: Client
    let prisma: typeof import("@/lib/prisma").prisma
    let Owners: typeof import("@/lib/services/owner.service").OwnerService

    const listed = async (session: { user: { id: string; role: string; companyId: string | null } }, params: string) => {
        const { buildUserWhereClause } = await import("@/lib/services/user-query")
        const built = buildUserWhereClause(session, new URLSearchParams(params), undefined, ROLES, STATUSES)
        if (built.empty) return []
        return (await prisma.user.findMany({ where: built.whereClause, select: { id: true }, orderBy: { id: "asc" } })).map(u => u.id)
    }

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
        process.env.POSTGRES_PRISMA_URL = url.toString()
        prisma = (await import("@/lib/prisma")).prisma
        Owners = (await import("@/lib/services/owner.service")).OwnerService
        await Owners.set("a2", true, by)
        await Owners.set("a3", true, by)
        await Owners.set("b1", true, by)
        // An owner once, from January to March: not one now.
        await db.query(`INSERT INTO "OwnerPeriod"(id, "userId", "startsAt", "endsAt") VALUES ('p1', 'a1', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z')`)
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("finds the owners now for the Owners list, and leaves them out of the Employees list", async () => {
        const amal = { user: { id: "a1", role: "ADMIN", companyId: "c1" } }
        expect(await listed(amal, "owners=only&excludeRole=SUPER_ADMIN")).toEqual(["a2", "a3"])
        expect(await listed(amal, "owners=leave&excludeRole=SUPER_ADMIN")).toEqual(["a1", "e1"])
        // Taken off, they're on the Employees list again.
        await Owners.set("a3", false, by)
        expect(await listed(amal, "owners=only&excludeRole=SUPER_ADMIN")).toEqual(["a2"])
        expect(await listed(amal, "owners=leave&excludeRole=SUPER_ADMIN")).toEqual(["a1", "a3", "e1"])
        // The Super Admin, looking at every company, sees each one's.
        const sa = { user: { id: "sa", role: "SUPER_ADMIN", companyId: null } }
        expect(await listed(sa, "owners=only&excludeRole=SUPER_ADMIN")).toEqual(["a2", "b1"])
    })

    it("says since when each owner is one, and their company's month now, in its own calendar", async () => {
        const { calendarDateStr } = await import("@/lib/time")
        const since = await Owners.sinceFor(["a1", "a2", "b1"])
        expect(since.has("a1")).toBe(false)
        expect(since.get("a2")).toEqual({ since: calendarDateStr(new Date(), "Africa/Cairo").slice(0, 7), month: calendarDateStr(new Date(), "Africa/Cairo").slice(0, 7) })
        expect(since.get("b1")).toEqual({ since: calendarDateStr(new Date(), "Pacific/Kiritimati").slice(0, 7), month: calendarDateStr(new Date(), "Pacific/Kiritimati").slice(0, 7) })
        expect((await Owners.sinceFor([])).size).toBe(0)
        // Each company's month now in its own calendar: on the 30th at noon
        // UTC, it's already December in Kiritimati, still November in Cairo.
        const late = await Owners.sinceFor(["a2", "b1"], new Date("2026-11-30T12:00:00Z"))
        expect(late.get("a2")?.month).toBe("2026-11")
        expect(late.get("b1")?.month).toBe("2026-12")
    })
})
