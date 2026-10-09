import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { rebaseOnDate, startFromStale } from "./rebase"

/** A form for changes from a date starts from the version in force on that date (review on #64). */
describe("a form moved to another date", () => {
    const march = { allowance: 240 }, april = { allowance: 60 }

    it("moves to the version in force there when untouched", () => {
        expect(rebaseOnDate({ base: march, current: { ...march }, stale: null }, april)).toEqual({ base: april, current: april, stale: null })
        // The same version, or none there: nothing moves.
        expect(rebaseOnDate({ base: march, current: { ...march }, stale: null }, { allowance: 240 })).toEqual({ base: march, current: march, stale: null })
        expect(rebaseOnDate({ base: march, current: march, stale: april }, null)).toEqual({ base: march, current: march, stale: null })
    })

    it("keeps edits, and says the date has another version, to start again from", () => {
        const edited = rebaseOnDate({ base: march, current: { allowance: 300 }, stale: null }, april)
        expect(edited).toEqual({ base: march, current: { allowance: 300 }, stale: april })
        expect(startFromStale(edited)).toEqual({ base: april, current: april, stale: null })
        // Back to the first date: nothing to say any more.
        expect(rebaseOnDate(edited, march).stale).toBeNull()
    })

    it("is what the policy editor does when its date changes", () => {
        const policy = readFileSync("components/AttendancePolicyPanel.tsx", "utf8")
        expect(policy).toContain("rebased(rebaseOnDate(based, startOn(date)))")
        expect(policy).not.toMatch(/onChange=\{e => setFrom\(e\.target\.value\)\}|onClick=\{\(\) => setFrom\(today\)\}/)
        expect(policy).toContain("startOn={editing.templateId ? undefined : date => policyOn(data.versions, date)?.body ?? null}")
    })
})
