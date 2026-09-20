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

/** Every migration directory, in the order Prisma applies them. */
const migrations = readdirSync(DIR, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name).sort()

/** The whole history concatenated. A table created by a migration added after
 *  the baseline is still created by the history, and the table check below has
 *  to see it — reading only the baseline would start failing the day somebody
 *  legitimately adds one, which teaches people to edit the test. */
const history = migrations
    .map(name => readFileSync(join(DIR, name, "migration.sql"), "utf8"))
    .join("\n")

const modelTables = [...readFileSync("prisma/schema.prisma", "utf8")
    .matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
    .map(m => m[2].match(/@@map\("([^"]+)"\)/)?.[1] ?? m[1])

describe("the history starts from the baseline and only moves forward", () => {
    it("still begins at 0_init", () => {
        // This used to assert the history held exactly one migration, which was
        // the right guard while the squash was the only thing in it and the
        // failure being prevented was a slide back to forty-eight drifted
        // files. Migrations added since are legitimate, so the guard now says
        // what is actually required: the baseline is present, and it is first.
        // A history that no longer starts here cannot rebuild the database.
        expect(migrations[0]).toBe("0_init")
    })

    it("adds nothing that would sort ahead of the baseline", () => {
        // Prisma applies in lexicographic order. A migration named so that it
        // sorts before "0_init" would run against an empty database and fail,
        // and the name is the only thing deciding that.
        const ahead = migrations.filter(m => m !== "0_init" && m < "0_init")
        expect(ahead, `these would run before the baseline: ${ahead.join(", ")}`).toEqual([])
    })

    it("creates every table the schema declares", () => {
        expect(modelTables.length).toBeGreaterThan(30)
        const missing = modelTables.filter(t => !history.includes(`CREATE TABLE "${t}"`))
        expect(missing, `tables no migration ever creates: ${missing.join(", ")}`).toEqual([])
    })

    it("gives every column the schema declares a home in the history", () => {
        // The failure that caused the squash was a column six migrations never
        // created, found only when a rebuild was attempted. Spot-checking the
        // newest column is not a general fix, but it does catch the specific
        // way this drifts: a schema edit that never became a migration.
        expect(history).toMatch(/ADD COLUMN "teamLeaderId"|"teamLeaderId" TEXT/)
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
