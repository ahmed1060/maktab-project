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

type Migration = { name: string; sql: string }

const DIR = "prisma/migrations"
const MIGRATIONS = readdirSync(DIR)
    .filter(m => m !== "migration_lock.toml")
    .sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))

/** A migration's SQL without its comments, which may name tables in passing. */
const withoutComments = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
const REPO: Migration[] = MIGRATIONS.map(name => ({ name, sql: withoutComments(readFileSync(`${DIR}/${name}/migration.sql`, "utf8")) }))

/**
 * What a migration does to tables and their RLS, one match per statement, in
 * the order they run: a table turned off after it was turned on is off
 * (Codex on #83). The last is a loop over the schema, as 0_init and
 * 20261105000000 have, which reaches every table there is.
 */
const STEP = new RegExp([
    String.raw`CREATE TABLE (?:IF NOT EXISTS )?(?:"public"\.)?"(?<created>[^"]+)"`,
    String.raw`ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:"public"\.)?"(?<from>[^"]+)" RENAME TO "(?<to>[^"]+)"`,
    String.raw`DROP TABLE (?:IF EXISTS )?(?:"public"\.)?"(?<dropped>[^"]+)"`,
    String.raw`ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:"public"\.)?"(?<table>[^"]+)" (?<state>ENABLE|DISABLE) ROW LEVEL SECURITY`,
    String.raw`FROM pg_tables WHERE schemaname = 'public'[\s\S]*?(?<every>ENABLE|DISABLE) ROW LEVEL SECURITY`,
].join("|"), "g")

/** Runs a migration's steps on the tables there are, and whether each has RLS on. */
function run(sql: string, rls: Map<string, boolean>) {
    for (const { groups: g = {} } of sql.matchAll(STEP)) {
        if (g.created) rls.set(g.created, false)
        else if (g.from) {
            rls.set(g.to, rls.get(g.from) ?? false)
            rls.delete(g.from)
        } else if (g.dropped) rls.delete(g.dropped)
        else if (g.table) rls.set(g.table, g.state === "ENABLE")
        else if (g.every) for (const table of rls.keys()) rls.set(table, g.every === "ENABLE")
    }
}

/** Each table there is after the migrations, in this order, and whether it has RLS on. */
function tablesAfter(migrations: Migration[]) {
    const rls = new Map<string, boolean>()
    for (const m of migrations) run(m.sql, rls)
    return rls
}

const off = (rls: Map<string, boolean>) => [...rls].filter(([, on]) => !on).map(([table]) => table)

describe("Row Level Security", () => {
    it("is on for every table the migrations leave", () => {
        const rls = tablesAfter(REPO)
        // The reading itself: it finds the tables, old and new.
        for (const table of ["User", "Company", "RoleGrant", "AttendancePunch", "RemovedRecordFile"]) expect(rls.has(table), table).toBe(true)
        expect(off(rls)).toEqual([])
    })

    it("is enabled by each migration after 20261105000000 that creates a table, in that migration", () => {
        const later = REPO.filter(m => m.name > "20261105000000_rls_every_table")
        const missing = later.flatMap(m => {
            const created = [...m.sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:"public"\.)?"([^"]+)"/g)].map(([, table]) => table)
            return created
                .filter(table => !new RegExp(`ALTER TABLE (?:ONLY )?(?:"public"\\.)?"${table}" ENABLE ROW LEVEL SECURITY`).test(m.sql))
                .map(table => `${m.name}: ${table}`)
        })
        expect(missing).toEqual([])
    })

    it("is off for a table a later migration turns it off for, and on again once one turns it back on", () => {
        const created = { name: "a", sql: `CREATE TABLE "Kept" (id TEXT); ALTER TABLE "Kept" ENABLE ROW LEVEL SECURITY;` }
        const disabled = { name: "b", sql: `ALTER TABLE "Kept" DISABLE ROW LEVEL SECURITY;` }
        const enabled = { name: "c", sql: `ALTER TABLE "Kept" ENABLE ROW LEVEL SECURITY;` }
        expect(off(tablesAfter([created, disabled]))).toEqual(["Kept"])
        expect(off(tablesAfter([created, disabled, enabled]))).toEqual([])
        // Within one migration too, by the order its statements run.
        expect(off(tablesAfter([{ name: "d", sql: created.sql + disabled.sql }]))).toEqual(["Kept"])
        // And by a loop over the schema.
        expect(off(tablesAfter([created, { name: "e", sql: `DO $$ BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t); END LOOP; END $$;` }]))).toEqual(["Kept"])
    })
})
