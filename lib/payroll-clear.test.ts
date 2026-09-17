import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    CLEARED,
    KEPT,
    decideClear,
    hostOf,
    confirmationPhraseFor,
    looksLikeProvedDrill,
    DRILL_RUN_MARKER,
    type ClearCheck,
} from "./payroll-clear"
import { stripComments } from "./strip-comments"

const pass = (name: string): ClearCheck => ({ name, passed: true, detail: "ok" })
const fail = (name: string): ClearCheck => ({ name, passed: false, detail: "no", remedy: "do the thing" })

describe("every check has to pass", () => {
    it("proceeds only when nothing is blocking", () => {
        expect(decideClear([pass("a"), pass("b")])).toEqual({ proceed: true, blocking: [] })
    })

    it("names what is blocking", () => {
        const decision = decideClear([pass("a"), fail("backup"), fail("drill")])
        expect(decision.proceed).toBe(false)
        expect(decision.blocking.map(c => c.name)).toEqual(["backup", "drill"])
    })

    it("refuses when the preflight did not run at all", () => {
        // An empty list is not a passing preflight. Without this, a preflight
        // that threw before producing any checks would read as "nothing is
        // blocking" — the failure mode where a safety check absent is a safety
        // check satisfied.
        expect(decideClear([])).toEqual({ proceed: false, blocking: [] })
    })
})

describe("the confirmation names the database", () => {
    it("takes the host out of the connection string and leaves the credentials", () => {
        const url = "postgresql://postgres:hunter2@db.example.supabase.co:5432/postgres"
        expect(hostOf(url)).toBe("db.example.supabase.co")
        expect(confirmationPhraseFor(hostOf(url)!)).not.toContain("hunter2")
    })

    it("is null for anything it cannot parse, so the check fails rather than guesses", () => {
        expect(hostOf(undefined)).toBeNull()
        expect(hostOf("")).toBeNull()
        expect(hostOf("not a url")).toBeNull()
    })

    it("differs between databases, so a phrase cannot be pasted at another one", () => {
        // The entire reason the host is in the phrase. A confirmation copied out
        // of a runbook is a confirmation that was not read.
        expect(confirmationPhraseFor("db.live.supabase.co"))
            .not.toBe(confirmationPhraseFor("db.drill.supabase.co"))
    })
})

describe("a proved drill is read from GitHub's own history", () => {
    const run = (over: Partial<{ conclusion: string; display_title: string }> = {}) => ({
        conclusion: "success",
        display_title: "Restore [drill] by @ahmed1060",
        ...over,
    })

    it("recognises a successful drill", () => {
        expect(looksLikeProvedDrill(run())).toBe(true)
    })

    it("does not accept a drill that failed", () => {
        expect(looksLikeProvedDrill(run({ conclusion: "failure" }))).toBe(false)
        expect(looksLikeProvedDrill(run({ conclusion: "cancelled" }))).toBe(false)
        expect(looksLikeProvedDrill({ display_title: "Restore [drill]" })).toBe(false)
    })

    it("does not accept a real restore as a drill", () => {
        // A production restore proves the path works too — but it proves it by
        // having already overwritten production, which is not a rehearsal.
        expect(looksLikeProvedDrill(run({ display_title: "Restore [production] by @ahmed1060" }))).toBe(false)
    })

    it("matches the marker the workflow actually writes", () => {
        // The guard that keeps the two halves in step: the run-name in
        // restore.yml and the marker this looks for.
        const workflow = readFileSync(".github/workflows/restore.yml", "utf8")
        expect(workflow).toContain("run-name: Restore [${{ github.event.inputs.target || 'production' }}]")
        expect(DRILL_RUN_MARKER).toBe("[drill]")
    })
})

describe("what the clear deletes and what it must not", () => {
    it("deletes the figures", () => {
        expect(CLEARED.map(t => t.table)).toEqual(["SalaryAdjustment", "SalaryRecord"])
    })

    it("keeps the two histories the calculation reads from", () => {
        // The mistake this exists to prevent is clearing everything with
        // "salary" in the name. Deleting SalaryChange does not reset payroll —
        // it makes every month, including paid ones, refuse to compute.
        const kept = KEPT.map(t => t.table)
        expect(kept).toContain("SalaryChange")
        expect(kept).toContain("EmploymentEvent")
        expect(kept.some(t => t.includes("AuditLog"))).toBe(true)
    })

    it("deletes the adjustments before the records that total them", () => {
        const order = CLEARED.map(t => t.table)
        expect(order.indexOf("SalaryAdjustment")).toBeLessThan(order.indexOf("SalaryRecord"))
    })
})

describe("the clear script refuses by default", () => {
    const script = stripComments(readFileSync("scripts/clear-payroll.ts", "utf8"))

    it("is a dry run unless told otherwise", () => {
        expect(script).toContain('argv.includes("--execute")')
        expect(script).toContain("Dry run. Nothing was deleted.")
    })

    it("has no flag that skips a failed check", () => {
        // An escape hatch on a gate like this is used exactly once, in the
        // moment somebody is in a hurry, which is the moment the gate is for.
        expect(script).not.toMatch(/--force|--skip-checks|SKIP_PREFLIGHT|ignoreChecks/)
    })

    it("requires an explicit scope rather than defaulting to everything", () => {
        expect(script).toContain("Scope is required")
    })

    it("treats an unreachable backup store as a failure, not an unknown", () => {
        const backup = script.slice(script.indexOf("async function checkBackup"), script.indexOf("async function checkDrill"))
        expect(backup).toContain("passed: false")
        expect(backup).not.toContain("passed: true,\n            detail: `Could not reach")
    })

    it("deletes both tables in one transaction", () => {
        // A half-cleared payroll — adjustments gone, records left holding
        // totals nothing adds up to — is worse than either end state.
        expect(script).toContain("prisma.$transaction")
        expect(script).toContain("salaryAdjustment.deleteMany")
        expect(script).toContain("salaryRecord.deleteMany")
    })
})

describe("the demo seed cannot reach anybody, and cannot delete a real company", () => {
    const script = stripComments(readFileSync("scripts/seed-payroll-demo.ts", "utf8"))

    it("builds every address through the unroutable helper", () => {
        expect(script).toContain("demoAddress(")
        expect(script).not.toMatch(/@(gmail|outlook|yahoo|hotmail)\./)
    })

    it("checks every account is seeded before removing the company", () => {
        // company.delete cascades to its people, their pay and their history.
        // A real company that happened to share the name would be removed by a
        // script whose whole purpose is to be safe.
        const remove = script.slice(script.indexOf("async function remove"), script.indexOf("async function seed"))
        expect(remove).toContain("isUnroutableAddress")
        expect(remove).toContain("Refusing to remove")
    })

    it("puts a leaver on each side of payday", () => {
        expect(script).toContain("PAYROLL_DAY - 5")
        expect(script).toContain("PAYROLL_DAY + 3")
    })

    it("files one adjustment against a month that has already passed", () => {
        // The capability the period columns exist for, demonstrated rather than
        // only described.
        expect(script).toContain("month: previous.month, year: previous.year")
    })
})
