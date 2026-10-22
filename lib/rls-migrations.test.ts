import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"

/**
 * Every table has Row Level Security on (DATABASE_SETUP.md).
 *
 * 0_init turned it on for every table there was, in a loop over the schema,
 * and nothing turned it on for the 44 tables later migrations created, until
 * 20261105000000_rls_every_table. This reads the migrations in the order
 * Prisma applies them and follows each table from the migration that creates
 * it, so a new table that doesn't enable RLS in its own migration fails here,
 * in CI, before any build applies it.
 *
 * Read from the SQL rather than a database because CI has none;
 * lib/rls.db.test.ts checks the same against a real Postgres.
 */

const DIR = "prisma/migrations"
const MIGRATIONS = readdirSync(DIR)
    .filter(m => m !== "migration_lock.toml")
    .sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))

/** A migration's SQL without its comments, which may name tables in passing. */
const sqlOf = (m: string) => readFileSync(`${DIR}/${m}/migration.sql`, "utf8").replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")

/** Each table there is after every migration, and whether it has RLS on. */
function tablesAfterMigrations() {
    const rls = new Map<string, boolean>()
    for (const m of MIGRATIONS) {
        const sql = sqlOf(m)
        // In the order a migration can do them: create, rename, drop, then enable.
        for (const [, table] of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:"public"\.)?"([^"]+)"/g)) rls.set(table, false)
        for (const [, from, to] of sql.matchAll(/ALTER TABLE (?:"public"\.)?"([^"]+)" RENAME TO "([^"]+)"/g)) {
            rls.set(to, rls.get(from) ?? false)
            rls.delete(from)
        }
        for (const [, table] of sql.matchAll(/DROP TABLE (?:IF EXISTS )?(?:"public"\.)?"([^"]+)"/g)) rls.delete(table)
        for (const [, table] of sql.matchAll(/ALTER TABLE (?:ONLY )?(?:"public"\.)?"([^"]+)" ENABLE ROW LEVEL SECURITY/g)) rls.set(table, true)
        // A loop over the schema, as 0_init and 20261105000000 have: every table there is.
        if (/FROM pg_tables WHERE schemaname = 'public'[\s\S]*ENABLE ROW LEVEL SECURITY/.test(sql)) for (const table of rls.keys()) rls.set(table, true)
    }
    return rls
}

describe("Row Level Security", () => {
    it("is on for every table the migrations leave", () => {
        const rls = tablesAfterMigrations()
        // The reading itself: it finds the tables, old and new.
        for (const table of ["User", "Company", "RoleGrant", "AttendancePunch", "RemovedRecordFile"]) expect(rls.has(table), table).toBe(true)
        expect([...rls].filter(([, on]) => !on).map(([table]) => table)).toEqual([])
    })

    it("is enabled by each migration after 20261105000000 that creates a table, in that migration", () => {
        const later = MIGRATIONS.filter(m => m > "20261105000000_rls_every_table")
        const missing = later.flatMap(m => {
            const sql = sqlOf(m)
            const created = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:"public"\.)?"([^"]+)"/g)].map(([, table]) => table)
            return created
                .filter(table => !new RegExp(`ALTER TABLE (?:ONLY )?(?:"public"\\.)?"${table}" ENABLE ROW LEVEL SECURITY`).test(sql))
                .map(table => `${m}: ${table}`)
        })
        expect(missing).toEqual([])
    })
})
