import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * End contract / Reinstate lives on the employee's profile view, not the edit
 * form. It commits through its own confirmation and never used the form, and
 * beside Update it read as though Update would apply it. Since PR 192 the view
 * is their details (components/profile/ProfileView.tsx), with the button beside
 * their status; the form opens its dialog.
 */
const FORM = stripComments(readFileSync("components/EmployeeProfileForm.tsx", "utf8"))

describe("End contract is on the profile view", () => {
    it("is shown in view mode and only there", () => {
        const opener = FORM.indexOf("onEndContract={() => setShowEndContract(true)}")
        expect(opener).toBeGreaterThan(-1)
        expect(FORM.match(/setShowEndContract\(true\)/g) ?? []).toHaveLength(1)
        // The view returns before the edit form does, so the form never offers it.
        const view = FORM.indexOf("if (isViewMode) {")
        expect(view).toBeGreaterThan(-1)
        expect(opener).toBeGreaterThan(view)
        expect(opener).toBeLessThan(FORM.indexOf("<form", view))
    })

    it("reloads the profile once it is done, so the new status shows", () => {
        expect(FORM).toContain("onDone={() => { setReloadKey(k => k + 1); router.refresh() }}")
        expect(FORM).toMatch(/\}, \[[^\]]*\breloadKey\b[^\]]*\]\)/)
    })
})
