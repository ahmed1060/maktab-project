import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"

/**
 * Every table has Row Level Security on (DATABASE_SETUP.md).
 *
 * 0_init turned it on for every table there was, in a loop over the schema,
 * and nothing turned it on for the 44 tables later migrations created, until
 * 20261105000000_rls_every_table. This reads the migrations in the orders
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

const CATCH_ALL = "20261105000000_rls_every_table"
/**
 * The migrations the catch-all covers: every one there was when it was
 * written. Any other enables RLS for the tables it creates, in that same
 * migration, whatever its name says. A name doesn't say when a migration was
 * added: one dated before the catch-all but added after it runs after it on
 * a database that has the catch-all, as production does (Codex on #83).
 */
const COVERED = new Set([
    "0_init",
    "20260920000000_team_leader",
    "20260927000000_roles",
    "20260928000000_role_templates",
    "20260929000000_role_requests",
    "20260930000000_acting_roles",
    "20261001000000_role_change_requests",
    "20261002000000_step_up",
    "20261003000000_access_reviews",
    "20261004000000_notification_keys",
    "20261005000000_access_review_snapshots",
    "20261006000000_admin_settings",
    "20261007000000_attendance_addons",
    "20261008000000_attendance_calendar",
    "20261008100000_schedule_defaults",
    "20261009000000_attendance_policy",
    "20261010000000_attendance_punches",
    "20261010100000_punch_user_cascade",
    "20261011000000_attendance_days",
    "20261012000000_attendance_requests",
    "20261013000000_attendance_day_decisions",
    "20261014000000_attendance_payroll",
    "20261015000000_attendance_discrepancies",
    "20261016000000_attendance_discrepancy_history",
    "20261017000000_attendance_entries_per_company",
    "20261018000000_attendance_terminals",
    "20261019000000_attendance_terminal_alerts",
    "20261020000000_attendance_work_locations",
    "20261021000000_attendance_check_in_phones",
    "20261022000000_attendance_check_ins",
    "20261023000000_attendance_push",
    "20261024000000_push_claim",
    "20261025000000_app_attest",
    "20261026000000_face_switches",
    "20261027000000_face_reviews",
    "20261028000000_face_keys",
    "20261029000000_face_key_relations",
    "20261030000000_face_purge_acknowledged",
    "20261031000000_agent_pending_tokens",
    "20261101000000_schedule_keys_deferred",
    "20261102000000_app_attest_environment",
    "20261103000000_brand_colour",
    "20261104000000_records_on_clients",
    "20261104000001_record_super_admin_actors",
    "20261104000002_removed_record_files",
    "20261104000003_records_grants_kept",
    "20261104000004_record_super_admin_creator",
])

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

/**
 * The order a database that has the catch-all applies them in: those it
 * covers and it, as they were, then the rest by name. A new database applies
 * them all by name.
 */
const deployOrder = (migrations: Migration[], covered = COVERED) => [
    ...migrations.filter(m => covered.has(m.name) || m.name === CATCH_ALL),
    ...migrations.filter(m => !covered.has(m.name) && m.name !== CATCH_ALL),
]

/** Each table left without RLS by a migration the catch-all doesn't cover, with the first that leaves it so. */
function leftOff(migrations: Migration[], covered = COVERED) {
    const rls = new Map<string, boolean>()
    const found = new Map<string, string>()
    for (const m of deployOrder(migrations, covered)) {
        run(m.sql, rls)
        if (covered.has(m.name) || m.name === CATCH_ALL) continue
        for (const table of off(rls)) if (!found.has(table)) found.set(table, `${m.name}: ${table}`)
    }
    return [...found.values()]
}

describe("Row Level Security", () => {
    it("is on for every table the migrations leave, in either order they're applied", () => {
        const rls = tablesAfter(REPO)
        // The reading itself: it finds the tables, old and new.
        for (const table of ["User", "Company", "RoleGrant", "AttendancePunch", "RemovedRecordFile"]) expect(rls.has(table), table).toBe(true)
        expect(off(rls)).toEqual([])
        expect(off(tablesAfter(deployOrder(REPO)))).toEqual([])
    })

    it("is enabled by each migration the catch-all doesn't cover, for the tables it creates, in that migration", () => {
        expect(leftOff(REPO)).toEqual([])
    })

    it("knows which migrations the catch-all covers: ones there are, named before it", () => {
        expect(MIGRATIONS).toContain(CATCH_ALL)
        expect([...COVERED].filter(m => !MIGRATIONS.includes(m) || (m !== "0_init" && m > CATCH_ALL))).toEqual([])
    })

    it("holds a migration added after the catch-all to enabling RLS itself, though it's named before it", () => {
        const loop = `DO $$ BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); END LOOP; END $$;`
        const init = { name: "0_init", sql: `CREATE TABLE "Old" (id TEXT); ${loop}` }
        const catchAll = { name: CATCH_ALL, sql: loop }
        const addedToday = { name: "20261023000000_added_today", sql: `CREATE TABLE "New" (id TEXT);` }
        const covered = new Set(["0_init"])
        expect(leftOff([init, addedToday, catchAll], covered)).toEqual(["20261023000000_added_today: New"])
        expect(off(tablesAfter(deployOrder([init, addedToday, catchAll], covered)))).toEqual(["New"])
        // Enabled in its own migration, it's on whichever order it runs in.
        const enabled = { ...addedToday, sql: `${addedToday.sql} ALTER TABLE "New" ENABLE ROW LEVEL SECURITY;` }
        expect(leftOff([init, enabled, catchAll], covered)).toEqual([])
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
