import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"

/**
 * Every table built by the migrations has Row Level Security on, with no
 * policies: default-deny for everyone but the tables' owner, which is how
 * the app connects (DATABASE_SETUP.md). lib/rls-migrations.test.ts reads the
 * same from the SQL, for CI; this checks it against what Postgres makes of it.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))

describe.skipIf(!ADMIN_URL)("Row Level Security, in Postgres", () => {
    const dbName = `rls_test_${Date.now()}`
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
        for (const m of MIGRATIONS) await db.query(readFileSync(`prisma/migrations/${m}/migration.sql`, "utf8"))
    }, 180_000)

    afterAll(async () => {
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    it("is on for every table, with no policy letting anyone in", async () => {
        const { rows } = await db.query(`
            SELECT c.relname AS name, c.relrowsecurity AS on,
                (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'`)
        expect(rows.length).toBeGreaterThan(70)
        expect(rows.filter(r => !r.on || r.policies > 0).map(r => r.name)).toEqual([])
    })
})
