import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * A username chosen for someone new is refused only when another person has
 * it, ignoring capitals, against a real Postgres. Prisma matches an
 * insensitive `equals` with ILIKE, so its %, _ and \ were patterns: "a_b"
 * was taken because "axb" was, and "%" because anyone was.
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
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'axb', 'c1'),
 ('e2', 'e2@x', 'p', 'Mona', 'One', 'EMPLOYEE', 2026, 'Mona', 'c1'),
 ('e3', 'e3@x', 'p', 'Badr', 'One', 'EMPLOYEE', 2026, 'ab', 'c1');
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any

describe.skipIf(!ADMIN_URL)("a username chosen for someone new, in Postgres", () => {
    const dbName = `username_conflict_test_${Date.now()}`
    let db: Client
    let Users: typeof import("@/lib/services/user.service").UserService

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
        Users = (await import("@/lib/services/user.service")).UserService
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    let n = 0
    const hire = (username: string) => {
        n += 1
        return Users.create({ firstName: "New", lastName: `Hire${n}`, email: `new${n}@x.co`, password: "a-long-password-123", role: "EMPLOYEE", username } as any, admin)
    }
    const holders = async (username: string) => (await db.query(`SELECT id FROM "User" WHERE username = $1`, [username])).rows.length

    it("refuses one another person has, ignoring capitals", async () => {
        await expect(hire("MONA")).rejects.toThrow("USERNAME_IN_USE")
        await expect(hire("mona")).rejects.toThrow("USERNAME_IN_USE")
        expect(await holders("MONA")).toBe(0)
    })

    it("takes _, % and \\ as typed, not as patterns", async () => {
        // "axb", "ab" and "Mona" are taken; none of these is.
        await hire("a_b")
        await hire("%")
        await hire("a\\b")
        await hire("Mon_")
        expect([await holders("a_b"), await holders("%"), await holders("a\\b"), await holders("Mon_")]).toEqual([1, 1, 1, 1])
    })

    it("still refuses one of those once it's taken", async () => {
        await expect(hire("A_B")).rejects.toThrow("USERNAME_IN_USE")
        await expect(hire("%")).rejects.toThrow("USERNAME_IN_USE")
    })
})
