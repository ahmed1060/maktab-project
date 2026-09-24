import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * End contract / Reinstate lives on the employee's profile view, not the edit
 * form. It commits through its own confirmation and never used the form, and
 * beside Update it read as though Update would apply it.
 */
const FORM = stripComments(readFileSync("components/EmployeeProfileForm.tsx", "utf8"))

describe("End contract is on the profile view", () => {
    it("is shown in view mode and only there", () => {
        const opener = FORM.indexOf("onClick={() => setShowEndContract(true)}")
        expect(opener).toBeGreaterThan(-1)
        expect(FORM.match(/setShowEndContract\(true\)/g) ?? []).toHaveLength(1)
        // The nearest mode check above the button is the one that gates it.
        const before = FORM.slice(0, opener)
        const gate = before.slice(before.lastIndexOf("isViewMode") - 1, before.lastIndexOf("isViewMode") + "isViewMode".length + 5)
        expect(gate).toMatch(/\{isViewMode && \(/)
    })

    it("reloads the profile once it is done, so the new status shows", () => {
        expect(FORM).toContain("onDone={() => { setReloadKey(k => k + 1); router.refresh() }}")
        expect(FORM).toMatch(/\}, \[[^\]]*\breloadKey\b[^\]]*\]\)/)
    })
})
