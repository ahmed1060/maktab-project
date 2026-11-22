import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

/**
 * The rest of the renaming to Nizmo (LATER_CHANGES_PLAN.md §4, PR 364): the
 * GitHub repository is "nizmo" now, and new backups are named nizmo_….
 *
 * GitHub forwards the old name, but the code names the repository it means,
 * as the payroll-clearing script says: a wrong one checks someone else's
 * history and passes.
 */

const read = (path: string) => readFileSync(path, "utf8")
const REPO = "ahmed1060/nizmo"

describe("the code names the repository Nizmo", () => {
    it("the Super Admin's backup and restore buttons dispatch to it", () => {
        for (const route of ["app/api/admin/maintenance/backup/route.ts", "app/api/admin/maintenance/restore/route.ts"]) {
            expect(read(route), route).toContain(`'https://api.github.com/repos/${REPO}/dispatches'`)
        }
    })

    it("the payroll-clearing script checks its Actions history", () => {
        expect(read("scripts/clear-payroll.ts")).toContain(`process.env.GITHUB_REPOSITORY || "${REPO}"`)
    })

    it("the README clones it", () => {
        expect(read("README.md")).toContain("https://github.com/YOUR_USERNAME/nizmo.git")
        expect(read("README.md")).toMatch(/^cd nizmo$/m)
    })
})

describe("backups are named nizmo_…, and the older ones still restore", () => {
    it("a new backup, and the copy made before a restore, start nizmo_", () => {
        expect(read(".github/workflows/backup.yml")).toContain('echo "NAME=nizmo_${STAMP}_${KIND}" >> $GITHUB_ENV')
        expect(read(".github/workflows/restore.yml")).toContain('echo "PRENAME=nizmo_${STAMP}_prerestore" >> $GITHUB_ENV')
    })

    it("a backup and a restore still wait for each other: one group, named for Nizmo", () => {
        expect(read(".github/workflows/backup.yml")).toMatch(/^ {2}group: nizmo-backup$/m)
        expect(read(".github/workflows/restore.yml")).toMatch(/^ {2}group: nizmo-backup$/m)
    })

    it("the newest backup is found by how its name ends, so a maktab_… one is found too", () => {
        const restore = read(".github/workflows/restore.yml")
        expect(restore).toContain('select(.Name | endswith("_db.sql.gz.age"))')
        expect(restore).not.toMatch(/startswith\(/)
    })
})

describe("nothing in the app still says maktab", () => {
    // The legal pages' test names the old address to check it's gone.
    const ALLOWED = new Set(["lib/legal-pages-blocks.test.ts", "lib/nizmo-names.test.ts"])

    it("app, components, lib, scripts, the workflows, the README and .env.example", () => {
        const files = execFileSync("git", ["ls-files", "app", "components", "lib", "scripts", ".github", "README.md", ".env.example"], { encoding: "utf8" })
            .split("\n").filter(f => f && !ALLOWED.has(f))
        const found = files.filter(f => /maktab/i.test(read(f)))
        expect(found).toEqual([])
    })
})
