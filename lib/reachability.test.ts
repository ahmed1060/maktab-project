import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * G1 and G5 — a stored thing nobody can get to.
 *
 * G1 is a backup that exists and will not load; G5 is a document that renders
 * and nothing links to. Both were invisible to every test, because a file that
 * uploads passes every test about uploading and a route that authorizes
 * correctly passes every test about authorization.
 */

function code(yaml: string): string {
    return yaml.split("\n").map(l => l.replace(/(^|\s)#.*$/, "$1")).join("\n")
}

const BACKUP = code(readFileSync(".github/workflows/backup.yml", "utf8"))
const RESTORE = code(readFileSync(".github/workflows/restore.yml", "utf8"))
const RUN_SERVICE = stripComments(readFileSync("lib/services/payroll-run.service.ts", "utf8"))
const LIST_API = stripComments(readFileSync("app/api/users/[id]/payslips/route.ts", "utf8"))
const REGISTER = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")
const MY_PAYSLIPS = readFileSync("app/(dashboard)/dashboard/documents/page.tsx", "utf8")
const SHELL = readFileSync("components/DashboardShell.tsx", "utf8")

describe("G1: a long-horizon copy can be taken on any day", () => {
    it("lets a run name its retention folder", () => {
        // The folder decides whether the copy survives 7 days or 365, and it
        // was decided entirely by today's date — so after the format changed on
        // 17 September, the earliest possible replacement monthly was 1 October.
        expect(BACKUP).toContain("destination:")
        expect(BACKUP).toContain("options: [auto, daily, weekly, monthly]")
    })

    it("still falls back to the calendar when nothing is named", () => {
        // The nightly schedule sends no inputs at all, so the old behaviour has
        // to survive an empty string.
        expect(BACKUP).toContain('CHOICE="${{ github.event.inputs.destination }}"')
        expect(BACKUP).toMatch(/case "\$CHOICE" in/)
        expect(BACKUP).toContain("daily|weekly|monthly)")
    })

    it("only ever files under one of the three known folders", () => {
        // DEST is interpolated straight into an rclone path. A free-text input
        // reaching it would be a path, not a folder name; the case arm is what
        // stops that, so it is pinned rather than trusted.
        expect(BACKUP).toContain('DEST="$CHOICE"')
        expect(BACKUP).not.toMatch(/DEST="\$\{?\{? ?github\.event\.inputs/)
    })
})

describe("G1: an unrestorable backup says so before it touches anything", () => {
    it("recognises a dump from before the format change", () => {
        expect(RESTORE).toMatch(/grep -Eq '\^\(DROP\|CREATE\) EVENT TRIGGER'/)
        expect(RESTORE).toMatch(/grep -Eq '\^CREATE EXTENSION'/)
    })

    it("checks before the database is touched, not during the load", () => {
        // The point is that nothing has changed when it refuses. Running this
        // after the DROP SCHEMA would make it a worse version of the failure it
        // replaces.
        const detector = RESTORE.indexOf("predates the 17 September 2026 dump format")
        const reset = RESTORE.indexOf("DROP SCHEMA IF EXISTS public CASCADE")
        expect(detector).toBeGreaterThan(-1)
        expect(reset).toBeGreaterThan(-1)
        expect(detector).toBeLessThan(reset)
    })

    it("reads a decompressed file rather than piping into grep", () => {
        // zcat | grep -q under pipefail makes a successful match read as a
        // failure — the mechanism that silently inverted every check in
        // backup.yml. The detector must not reintroduce it.
        expect(RESTORE).toContain("gunzip -c db.sql.gz > /tmp/restore-dump.sql")
        expect(RESTORE).not.toMatch(/zcat db\.sql\.gz \| grep -Eq/)
    })

    it("says what to do instead of only what went wrong", () => {
        expect(RESTORE).toContain("Nothing has been changed")
        expect(RESTORE).toContain("pick a backup taken on or after")
    })

    it("does not quietly load it on the old terms", () => {
        // A restore that changes how it works depending on the file it was
        // handed is one nobody can reason about at 3am.
        const window = RESTORE.slice(RESTORE.indexOf("predates the 17 September"), RESTORE.indexOf("Restore database"))
        expect(window).toContain("exit 1")
        expect(window).not.toContain("--exclude")
    })
})

describe("G5: a payslip can be reached", () => {
    it("the register carries an id per row once a draft exists", () => {
        expect(RUN_SERVICE).toContain("payslipIds:")
        expect(RUN_SERVICE).toContain("run.payslips.map(p => [p.userId, p.id])")
    })

    it("and shows no link when there is nothing to link to", () => {
        // A computed row that was never stored has no payslip. A link to one
        // that does not exist is worse than no link.
        expect(RUN_SERVICE).toContain("payslipIds: run")
        expect(REGISTER).toContain("view?.payslipIds?.[entry.userId] && !entry.excluded")
        expect(REGISTER).toContain("/dashboard/documents/payslip/")
    })

    it("there is a list a person can open for themselves", () => {
        expect(MY_PAYSLIPS).toContain("/api/users/${userId}/payslips")
        expect(MY_PAYSLIPS).toContain("/dashboard/documents/payslip/")
    })

    it("and something in the product links to that list", () => {
        // The whole of G5: the page existed and nothing pointed at it.
        expect(SHELL).toContain('href="/dashboard/documents"')
        expect(SHELL).toContain("my_payslips")
    })

    it("holds the list to the payslip document's own rules", () => {
        // Not new rules — the same two readers, so a list cannot disclose what
        // the document would refuse.
        expect(LIST_API).toContain("managesCompany(session.user, \"payroll.view\", user.companyId)")
        expect(LIST_API).toContain("isOwner && user.company?.payslipsVisible")
        expect((LIST_API.match(/ApiResponse\.forbidden\(/g) ?? []).length).toBe(1)
    })

    it("never lists a draft", () => {
        // A draft is recomputed every time the register is opened. A payslip
        // somebody saw and can no longer find is worse than one they never saw.
        expect(LIST_API).toContain('status: { in: ["APPROVED", "PAID"] }')
        expect(LIST_API).toContain("excluded: false")
    })

    it("tells somebody their company switched it off rather than denying them", () => {
        expect(MY_PAYSLIPS).toMatch(/\.status === 403/)
        expect(MY_PAYSLIPS).toContain("my_payslips_off")
    })
})

describe("the copy exists in both languages", () => {
    it("every English key has an Arabic value", () => {
        const missing = Object.keys(en as any).filter(k => !(k in (ar as any)))
        expect(missing, `no Arabic translation:\n${missing.join("\n")}`).toEqual([])
    })
})
