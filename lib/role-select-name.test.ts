import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"

/**
 * The Role dropdown has a name a screen reader can say. Found by running axe
 * on every page: on the employee profile and in role change requests it was
 * announced as an unnamed list.
 */
describe("a Role select", () => {
    it("is a Field's, named by the label on screen", () => {
        // Role change requests ask on the building blocks since the Super Admin's
        // pages part 2a: the Role select is a Field, labelled on screen.
        expect(readFileSync("components/RoleChangeRequests.tsx", "utf8")).toContain("<Field label={t('role_changes_role')}>")
        // A person's profile too, and asking from their details, since its part 4
        // (PR 194): the old dropdown, named for screen readers alone, is gone.
        expect(readFileSync("components/profile/RoleFields.tsx", "utf8")).toContain("<Field label={t('role_label')} hint={hint} error={errors.roleId}>")
        expect(readFileSync("components/profile/RoleRequestDialog.tsx", "utf8")).toContain("<Field label={t('role_label')} error={errors.roleId}>")
        expect(existsSync("components/RoleSelect.tsx")).toBe(false)
    })

    it("and the access review's interval says what it is", () => {
        // A labelled field in the access review's own card since part 4b.
        expect(readFileSync("components/AccessReviewSetting.tsx", "utf8")).toContain("<Field label={t('access_review_every')}>")
    })
})
