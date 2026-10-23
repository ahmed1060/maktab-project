import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * A person stays in the company they were added to (CLIENTS_PLAN.md change
 * log, 2026-10-23). A Super Admin's edit form offered every company, and the
 * save moved the person to the one picked. The form now shows their company
 * greyed out and sends none; the server refuses any other
 * (COMPANY_CHANGE_FORBIDDEN, checked in lib/permissions/employee-access and
 * the attendance tests).
 */

// Read as written: lib/strip-comments.ts takes the form's `accept="image/*"`
// for the start of a comment, and the company field with it.
const FORM = readFileSync("components/EmployeeProfileForm.tsx", "utf8")

/** The first element matching `marker`, up to the end of its opening tag. */
function openingTag(source: string, marker: RegExp): string {
    const start = source.search(marker)
    expect(start, `missing: ${marker}`).toBeGreaterThan(-1)
    let depth = 0
    for (let i = start; i < source.length; i++) {
        if (source[i] === "{") depth++
        else if (source[i] === "}") depth--
        else if (source[i] === ">" && depth === 0) return source.slice(start, i + 1)
    }
    throw new Error(`unclosed tag at ${marker}`)
}

describe("editing a person, their company", () => {
    it("is shown greyed out, and can't be picked", () => {
        const select = openingTag(FORM, /<select\s+aria-label=\{t\('company_label'\)\}/)
        expect(select).toMatch(/\bdisabled\b(?!=)/)
        expect(select).not.toContain("onChange")
        expect(select).toContain("cursor: 'not-allowed'")
    })

    it("isn't sent with the save", () => {
        const save = FORM.slice(FORM.indexOf("fetch('/api/users', {"), FORM.indexOf("fetch('/api/users', {") + 3000)
        expect(save).not.toMatch(/\bcompanyId\s*:/)
    })
})
