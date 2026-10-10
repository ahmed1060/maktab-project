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

    it("is what the policy editor and the hours form do when their date changes", () => {
        const policy = readFileSync("components/AttendancePolicyPanel.tsx", "utf8")
        expect(policy).toContain("rebased(rebaseOnDate(based, startOn(date)))")
        expect(policy).not.toMatch(/onChange=\{e => setFrom\(e\.target\.value\)\}|onClick=\{\(\) => setFrom\(today\)\}/)
        expect(policy).toContain("startOn={editing.templateId ? undefined : date => policyOn(data.versions, date)?.body ?? null}")
        const hours = readFileSync("components/CompanyAttendanceCard.tsx", "utf8")
        expect(hours).toContain("rebased(rebaseOnDate(based, inForce ? formFromVersion(inForce) : null))")
        expect(hours).toContain("const inForce = versionOn(editing.schedule.versions, date)")
        // Every way the date moves goes through it: the field and both shortcuts.
        const form = hours.slice(hours.indexOf("function HoursModal"), hours.indexOf("function HoursModal") + 9000)
        expect(form).not.toMatch(/setFrom\((today|firstOfNextMonth\(today\)|e\.target\.value)\)/)
    })
})
