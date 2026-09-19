import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * The baseline migration has to rebuild everything, not just the tables.
 *
 * Forty-eight migrations were squashed into prisma/migrations/0_init because
 * they could not rebuild the database at all — `migrate deploy` onto an empty
 * one failed on a column no migration ever created.
 *
 * The hazard in a squash is not the tables. `prisma migrate diff` regenerates
 * those perfectly, and it is easy to look at 1000 lines of CREATE TABLE and
 * conclude the job is done. What it cannot regenerate is everything a Prisma
 * schema has no way to express — and in this database that is a security
 * trigger and row level security on every table. A regenerated baseline that
 * dropped them would apply cleanly, match the schema, pass `migrate diff`, and
 * quietly leave the database unprotected.
 *
 * So these assert the parts no diff will ever put back.
 */

const DIR = "prisma/migrations"
const baseline = readFileSync(join(DIR, "0_init", "migration.sql"), "utf8")

const modelTables = [...readFileSync("prisma/schema.prisma", "utf8")
    .matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
    .map(m => m[2].match(/@@map\("([^"]+)"\)/)?.[1] ?? m[1])

describe("the migration history is a single baseline", () => {
    it("holds exactly one migration", () => {
        const dirs = readdirSync(DIR, { withFileTypes: true })
            .filter(e => e.isDirectory()).map(e => e.name)
        expect(dirs).toEqual(["0_init"])
    })

    it("creates every table the schema declares", () => {
        expect(modelTables.length).toBeGreaterThan(30)
        const missing = modelTables.filter(t => !baseline.includes(`CREATE TABLE "${t}"`))
        expect(missing, `tables the baseline never creates: ${missing.join(", ")}`).toEqual([])
    })
})

describe("it carries what a Prisma schema cannot express", () => {
    it("keeps the SuperAdmin deletion backstop", () => {
        // A database-level guard that holds against a direct SQL DELETE, which
        // is the only way to delete one of these today. Both arms matter: a
        // protected row, and the last row whether flagged or not.
        expect(baseline).toMatch(/CREATE OR REPLACE FUNCTION prevent_protected_superadmin_delete/)
        expect(baseline).toMatch(/CREATE TRIGGER trg_prevent_protected_superadmin_delete/)
        expect(baseline).toMatch(/Cannot delete a protected SuperAdmin account/)
        expect(baseline).toMatch(/Cannot delete the last remaining SuperAdmin account/)
    })

    it("seeds the one row SystemSettings is meant to hold", () => {
        // `prisma migrate diff` generates schema and never data, so a baseline
        // built from it alone drops this. It is the only data statement in the
        // old history that is not a backfill — the rest read existing rows and
        // rewrite them, which on an empty database are correctly no-ops.
        //
        // Nothing would have crashed without it: SystemSettingsService.get()
        // falls back to defaults when the row is missing. The settings screen
        // would simply have had nothing to write to, which is the kind of fault
        // that surfaces weeks later.
        expect(baseline).toMatch(/INSERT INTO "SystemSettings"[\s\S]{0,120}VALUES \('default'/)
    })

    it("enables row level security by iterating, not by naming tables", () => {
        // The original migration listed 24 tables by hand. Eleven created since
        // were never added, seven of them payroll tables. A hand-written list is
        // a list that drifts; a loop over pg_tables cannot.
        expect(baseline).toMatch(/FROM pg_tables WHERE schemaname = 'public'/)
        expect(baseline).toMatch(/ENABLE ROW LEVEL SECURITY/)

        // And specifically not a hand-maintained list, which is what regressed.
        const named = [...baseline.matchAll(/ALTER TABLE "\w+" ENABLE ROW LEVEL SECURITY/g)]
        expect(named, "RLS must not go back to naming tables one by one").toEqual([])
    })
})
