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

    it("skips extension DDL only where the extensions cannot exist", () => {
        // The dump carries CREATE EXTENSION for everything Supabase installs
        // into pg_catalog — pg_cron among them — which --exclude-schema does
        // not cover. A stock postgres image has none of them, and ON_ERROR_STOP
        // turns the first into a failed load.
        //
        // They must stay in the dump: a real restore goes back to Supabase,
        // where they exist and IF NOT EXISTS makes them a no-op. Strip them at
        // dump time and a restored project silently loses its extensions.
        const prove = BACKUP_CODE.split("- name:").find(s => s.includes("Prove the dump restores"))!
        expect(prove, "the verifier no longer skips extension DDL").toContain(
            "grep -vE '^(CREATE|COMMENT ON) EXTENSION'",
        )
        expect(
            BACKUP_CODE,
            "extensions are being excluded from the dump itself, not just from the check",
        ).not.toContain("--exclude-extension")

        // A production restore loads the dump exactly as taken; only the drill,
        // which is a plain Postgres, filters.
        const restoreStep = RESTORE_CODE.split("- name:").find(s => s.includes("Restore database"))!
        expect(restoreStep).toContain('if [ "$IS_DRILL" = "true" ]')
        expect(restoreStep).toContain("grep -vE '^(CREATE|COMMENT ON) EXTENSION'")
    })

    it("proves the dump applies and holds rows", () => {
        expect(BACKUP_CODE).toContain("--single-transaction -v ON_ERROR_STOP=1")
        expect(BACKUP_CODE).toContain("Dump restored but holds no users")
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
