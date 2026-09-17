import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The two backup workflows never run in CI, are never typechecked, and are
 * exercised for real once a night — which is how the asset half of every
 * backup stayed unfailable for months and how the restore path reached
 * September 2026 without being run once.
 *
 * Everything pinned here is a property that is invisible until the day it
 * matters, and that day is the worst possible one to discover it on.
 */
const BACKUP = readFileSync(".github/workflows/backup.yml", "utf8")
const RESTORE = readFileSync(".github/workflows/restore.yml", "utf8")

/** Drop `#` comments so an assertion cannot be satisfied by prose explaining it. */
function code(yaml: string): string {
    return yaml
        .split("\n")
        .map(line => line.replace(/(^|\s)#.*$/, "$1"))
        .join("\n")
}

const BACKUP_CODE = code(BACKUP)
const RESTORE_CODE = code(RESTORE)

describe("a restore is all-or-nothing", () => {
    it("stops psql on the first error", () => {
        // Without this psql prints errors and exits 0, so a restore that
        // destroyed the database and failed to refill it finishes green.
        expect(RESTORE_CODE).toContain("ON_ERROR_STOP=1")
    })

    it("wraps the restore in one transaction", () => {
        // The dump runs --clean --if-exists and drops as it goes. A failure
        // halfway through without this leaves the database half-dropped and
        // half-restored, which is worse than not having started.
        expect(RESTORE_CODE).toContain("--single-transaction")
    })

    it("fails a pipe whose left-hand side dies", () => {
        // The default shell for a `run:` block is `bash -e` with no pipefail,
        // so `gunzip -c bad.gz | psql` reports psql's exit code and a truncated
        // file restores silently. Every step that pipes needs this.
        for (const [name, source] of [["backup", BACKUP_CODE], ["restore", RESTORE_CODE]] as const) {
            const pipedSteps = source.split("- name:").filter(step => /\|\s*(gunzip|zcat|jq|gzip|\/usr\/lib)/.test(step) || /\| gzip/.test(step))
            for (const step of pipedSteps) {
                const title = step.split("\n")[0].trim()
                expect(step, `${name}: step "${title}" pipes without pipefail`).toContain("set -o pipefail")
            }
        }
    })

    it("checks what it got back, not just that the command returned", () => {
        // A restore that succeeds into an empty database is the failure nobody
        // notices until somebody tries to sign in.
        expect(RESTORE_CODE).toMatch(/count\(\*\) FROM/)
        expect(RESTORE_CODE).toContain("holds no users")
    })
})

describe("the asset mirror can fail", () => {
    it("does not swallow the copy's exit code", () => {
        // `rclone copy supa:app-assets ./assets ... || true` is what made the
        // asset half of every backup unfailable. Paired with the sync on the
        // other end it was the most dangerous line in the repository: a backup
        // that silently captured nothing became a restore that deleted
        // everything.
        const mirror = BACKUP_CODE.split("- name:").find(s => s.includes("supa:app-assets"))
        expect(mirror, "backup.yml no longer mirrors the bucket").toBeDefined()
        expect(mirror!).not.toMatch(/rclone copy supa:app-assets[^\n]*\|\|\s*true/)
    })

    it("records how much there was supposed to be", () => {
        expect(BACKUP_CODE).toContain("rclone size supa:app-assets --json")
        expect(BACKUP_CODE).toContain("manifest.json")
    })

    it("keeps the manifest out of the tree that gets synced", () => {
        // Anything under ./assets is uploaded into the bucket on restore, so
        // the manifest travels beside that directory, never inside it.
        expect(BACKUP_CODE).toContain("tar -czf assets.tar.gz assets manifest.json")
        expect(BACKUP_CODE).not.toContain("> assets/manifest.json")
    })
})

describe("nothing syncs over the bucket unchecked", () => {
    it("gates every sync on the manifest", () => {
        // sync deletes whatever is not in the source. The count check is the
        // only thing standing between a half-copied snapshot and an emptied
        // bucket, so the two must stay in the same step.
        const syncStep = RESTORE_CODE.split("- name:").find(s => s.includes("rclone sync ./assets supa:app-assets"))
        expect(syncStep, "restore.yml no longer syncs assets").toBeDefined()
        expect(syncStep!, "the sync is no longer preceded by a manifest check").toContain("manifest.json")
        expect(syncStep!).toMatch(/-ge\s+"\$EXPECTED"|"\$FOUND"\s+-ge/)
    })

    it("falls back to copy rather than sync when a snapshot predates the manifest", () => {
        // Every backup taken before the manifest existed has none. Refusing
        // outright would make the entire current archive unrestorable; copy
        // adds and overwrites but never deletes, so nothing can be lost.
        const syncStep = RESTORE_CODE.split("- name:").find(s => s.includes("rclone sync ./assets supa:app-assets"))!
        expect(syncStep).toContain("rclone copy ./assets supa:app-assets")
    })
})

describe("the safety snapshot is restorable by the tool that made it", () => {
    it("names its tarball root the same as every other snapshot", () => {
        // It used to tar a directory called pre_assets/, while the restore step
        // extracts and syncs ./assets — so restoring a pre-restore snapshot,
        // which is the entire point of having one, brought the database back
        // and then failed on a directory that was not there.
        expect(RESTORE_CODE).toContain("tar -czf pre_assets.tar.gz -C prerestore-stage assets manifest.json")
        expect(RESTORE_CODE).not.toMatch(/tar -czf pre_assets\.tar\.gz pre_assets/)
    })

    it("clears its staging directory before the target snapshot is extracted", () => {
        // Two trees named assets/ in the workspace would merge, and the sync
        // would then upload the union of a snapshot and the state it replaced.
        expect(RESTORE_CODE).toContain("rm -rf prerestore-stage")
    })
})

describe("a drill rehearses what production actually does", () => {
    it("loads the dump the same way on both paths", () => {
        // The drill used to strip CREATE/COMMENT ON EXTENSION, on the belief
        // that its target would be a plain Postgres. A drill that skips
        // statements production runs is not a rehearsal of production, it is a
        // rehearsal of something easier — and the statements it skipped are
        // exactly the ones most likely to break a real restore.
        expect(RESTORE_CODE).not.toContain("COMMENT ON) EXTENSION")
        expect(RESTORE_CODE.split("--single-transaction -v ON_ERROR_STOP=1").length - 1).toBe(1)
    })

    it("says which kind of Supabase connection string, because the obvious one does not work", () => {
        // db.<ref>.supabase.co is IPv6-only and a GitHub runner has no IPv6
        // route, so the dashboard's first suggestion fails with "Network is
        // unreachable" — which reads as the database being down rather than as
        // the wrong hostname. Cost one drill run to find out; written down so
        // it cannot cost a second.
        expect(RESTORE).toMatch(/Session pooler/)
        expect(RESTORE).toMatch(/IPv6 only/)
        expect(RESTORE).toMatch(/transaction\* pooler on 6543/)
    })

    it("says the drill target has to be a Supabase project", () => {
        // Written down where somebody setting the secret will read it. A stock
        // Postgres fails on the event triggers the dump carries, with an error
        // that does not name the cause.
        // Asserted against the raw file, not the comment-stripped copy: this
        // one *is* prose, and prose in the right place is the deliverable.
        expect(RESTORE).toMatch(/DRILL_DATABASE_URL must be a\s*\n?\s*#?\s*Supabase project, not a stock Postgres/)
    })
})

describe("a drill cannot touch production", () => {
    it("never selects the target with && / ||", () => {
        // `IS_DRILL && secrets.DRILL || secrets.PROD` reads correctly and is a
        // trap: GitHub's && yields the right-hand value, so an unset
        // DRILL_DATABASE_URL makes it empty, empty is falsy, and || hands back
        // production. Selecting a drill would restore over production with the
        // summary still reporting a drill.
        expect(
            RESTORE_CODE,
            "the restore target is chosen with an expression that falls through to production",
        ).not.toMatch(/secrets\.DRILL_DATABASE_URL\s*\|\|\s*secrets\.SUPABASE_DIRECT_URL/)
    })

    it("refuses rather than falling back when the drill target is missing", () => {
        expect(RESTORE_CODE).toContain("Refusing to fall back to production")
    })

    it("leaves the storage bucket alone", () => {
        // There is one bucket and no drill copy of it, so syncing during a
        // rehearsal would overwrite production's files from a test — the exact
        // accident this workflow exists to recover from.
        const syncStep = RESTORE_CODE.split("- name:").find(s => s.includes("rclone sync ./assets supa:app-assets"))!
        expect(syncStep).toContain("if: env.IS_DRILL != 'true'")
    })
})

describe("every night's dump is loaded back", () => {
    it("runs a throwaway Postgres to restore into", () => {
        expect(BACKUP_CODE).toContain("image: postgres:17")
    })

    it("health-checks it as a role that exists", () => {
        // A bare `pg_isready` runs as the container's OS user, which is root,
        // and Postgres answers "FATAL: role root does not exist" every time.
        // The service then never reports healthy, and GitHub fails the job
        // before a single step runs — so the whole backup is lost to a check
        // that was only ever meant to wait for the database.
        expect(
            BACKUP_CODE,
            "the service health check does not name a database user",
        ).toContain('--health-cmd "pg_isready -U postgres"')
    })

    it("names the statement that failed, not just the error", () => {
        // "ERROR: relation X does not exist" without the statement that caused
        // it is most of a diagnosis and none of an answer. A real restore fails
        // once, in the worst hour of the year, and the log it leaves is all
        // anybody gets.
        for (const [name, source] of [["backup", BACKUP_CODE], ["restore", RESTORE_CODE]] as const) {
            expect(source, `${name}.yml loads without --echo-errors`).toContain("--echo-errors")
        }
    })

    it("asks the nightly verifier the same question the disaster will", () => {
        // This was deliberately tolerant while the dump carried Supabase's
        // globals, and that was right at the time. It stopped being right the
        // moment --schema=public removed them: a tolerant load cannot tell "the
        // dump applies cleanly" from "the dump applies apart from the eight
        // statements that would abort a real restore", and it was the second of
        // those for months without anyone being able to see it.
        const prove = BACKUP_CODE.split("- name:").find(s => s.includes("Prove the dump restores"))!
        expect(prove, "the nightly verifier went back to ignoring errors").toContain("--single-transaction -v ON_ERROR_STOP=1")
        expect(prove, "the nightly verifier no longer ignores errors, but also no longer counts what landed").toContain("information_schema.tables")
        expect(prove, "the verifier no longer requires rows").toContain("Dump restored but holds no users")

        // The real restore asks it too, in the same words.
        const restoreStep = RESTORE_CODE.split("- name:").find(s => s.includes("Restore database"))!
        expect(restoreStep).toContain("--single-transaction -v ON_ERROR_STOP=1")
    })

    it("dumps by allowlist, in both workflows", () => {
        // A denylist has to enumerate everything the platform might ever add,
        // and this one failed four times doing it: CREATE EXTENSION in
        // pg_catalog, COPY cron.job, event triggers belonging to no schema, and
        // finally "must be owner of event trigger pgrst_drop_watch" — the one
        // that would have failed a production restore identically, because all
        // eight of those triggers are owned by supabase_admin and the
        // connection role is postgres.
        //
        // An allowlist has to name what we own: one schema. Objects with no
        // schema are not dumped under -n at all, so the class ends at the
        // source instead of being filtered downstream.
        //
        // Both workflows, because restore.yml's dump is the pre-restore
        // snapshot — the thing somebody restores after a restore went wrong,
        // where different terms from the backups beside it are a trap laid for
        // the worst possible moment.
        for (const [name, source] of [["backup", BACKUP_CODE], ["restore", RESTORE_CODE]] as const) {
            expect(source, `${name}.yml does not dump by allowlist`).toContain("--schema=public")
            expect(source, `${name}.yml went back to a denylist`).not.toContain("--exclude-schema")
        }
    })

    it("proves the dump carries nothing the restore role cannot own", () => {
        // Asserted on the artifact rather than inferred from the flag. Every
        // one of these was in a real dump and each broke a real restore, so if
        // one comes back it should fail on the night it starts, not during the
        // restore nobody gets to retry.
        const check = BACKUP_CODE.split("- name:").find(s => s.includes("nothing the restore role cannot own"))!
        expect(check, "the dump is no longer checked for platform objects").toBeTruthy()
        for (const pattern of ["EVENT TRIGGER", "EXTENSION", "DROP SCHEMA", "CREATE SCHEMA"]) {
            expect(check, `the dump is no longer checked for ${pattern}`).toContain(pattern)
        }
        // And that "clean" cannot be achieved by dumping nothing at all.
        expect(check).toContain("CREATE TABLE public")
    })

    it("does it after the upload, so a night that cannot prove itself is still stored", () => {
        // And because the step failing stops the job, the prune never runs —
        // a night that cannot verify also cannot age out the nights that could.
        const upload = BACKUP_CODE.indexOf("Upload to Google Drive")
        const prove = BACKUP_CODE.indexOf("Prove the dump restores")
        const prune = BACKUP_CODE.indexOf("Prune old backups")
        expect(upload).toBeGreaterThan(-1)
        expect(prove, "the restore check no longer runs after the upload").toBeGreaterThan(upload)
        expect(prune, "the prune no longer runs after the restore check").toBeGreaterThan(prove)
    })
})
