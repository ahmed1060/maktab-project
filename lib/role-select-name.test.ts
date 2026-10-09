import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The Role dropdown has a name a screen reader can say. Found by running axe
 * on every page: on the employee profile and in role change requests it was
 * announced as an unnamed list.
 */
describe("RoleSelect", () => {
    it("is named: \"Role\", or what the form's own label says", () => {
        const select = readFileSync("components/RoleSelect.tsx", "utf8")
        expect(select).toContain("aria-label={ariaLabel ?? t('role_label')}")
        expect(readFileSync("components/RoleChangeRequests.tsx", "utf8")).toContain("ariaLabel={t('role_changes_role')}")
    })
})
