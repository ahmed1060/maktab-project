import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION } from "./permissions/catalogue"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { sideBarFor, type SideBarViewer } from "./side-bar"
import { rolesAndAccessTabs, rolesAndAccessTab } from "./roles-and-access"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Answering access reviews, a permission of its own (LATER_CHANGES_PLAN.md
 * §7.15; ROLES_PLAN.md §6.14): employees.review_access, where Assign roles
 * was. Every role with Assign roles is given it, so nothing changes until
 * it's unticked.
 */

const read = (path: string) => stripComments(readFileSync(path, "utf8"))
const MIGRATION = "prisma/migrations/20270127000000_access_review_permission/migration.sql"

describe("the permission", () => {
    it("is in Employees beside Assign roles, for the whole company, with See employees", () => {
        expect(PERMISSIONS["employees.review_access"]).toEqual({ code: 95, module: "EMPLOYEES", scopes: ["COMPANY"], implies: ["employees.view"] })
        // A new permission, so tokens reload once (CATALOGUE_VERSION).
        expect(CATALOGUE_VERSION).toBe(16)
    })

    it("is the built-in Admin's, not a Team Leader's or an Employee's", () => {
        expect(BUILT_IN_GRANTS.ADMIN["employees.review_access"]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.TEAM_LEADER["employees.review_access"]).toBeUndefined()
        expect(BUILT_IN_GRANTS.EMPLOYEE["employees.review_access"]).toBeUndefined()
    })

    it("is named in both languages", () => {
        expect(en.perm_employees_review_access).toBe("Answer access reviews")
        expect(ar.perm_employees_review_access).toBe("الرد على مراجعات الصلاحيات")
    })

    it("isn't one of the permissions a review asks about", () => {
        expect(read("lib/services/access-review.service.ts")).toContain(`export const REVIEWED: readonly Permission[] = ["salary.view", "salary.edit", "payroll.approve", "employees.assign_role"]`)
    })
})

describe("given to the roles already there", () => {
    const sql = read(MIGRATION)

    it("gives it to every role holding Assign roles, at the company's scope", () => {
        expect(sql).toMatch(/INSERT INTO "RoleGrant" \("roleId", "permission", "scope"\)\s+SELECT g\."roleId", 'employees\.review_access', 'COMPANY'::"PermissionScope"\s+FROM "RoleGrant" g WHERE g\."permission" = 'employees\.assign_role'\s+ON CONFLICT \("roleId", "permission"\) DO NOTHING/)
    })

    it("has the holders of the roles it changes reload, and only those", () => {
        expect(sql).toMatch(/RETURNING "roleId"\s*\)\s*UPDATE "Role" SET "version" = "version" \+ 1, "updatedAt" = now\(\) WHERE "id" IN \(SELECT "roleId" FROM given\)/)
    })

    it("gives it to every role template naming Assign roles, once", () => {
        expect(sql).toContain(`jsonb_build_object('permission', 'employees.review_access', 'scope', 'COMPANY')`)
        expect(sql).toContain(`WHERE e->>'permission' = 'employees.assign_role'`)
        expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM jsonb_array_elements\(t\."grants"::jsonb\) e WHERE e->>'permission' = 'employees\.review_access'\)/)
    })
})

describe("Roles and access", () => {
    const holds = (...permissions: string[]) => (p: string) => permissions.includes(p)

    it("has a tab for each of the two the viewer holds", () => {
        expect(rolesAndAccessTabs(holds("employees.assign_role", "employees.review_access"))).toEqual(["changes", "reviews"])
        expect(rolesAndAccessTabs(holds("employees.assign_role"))).toEqual(["changes"])
        expect(rolesAndAccessTabs(holds("employees.review_access"))).toEqual(["reviews"])
        expect(rolesAndAccessTabs(holds("employees.request_role"))).toEqual([])
    })

    it("opens on the tab asked for where it's theirs, else their first", () => {
        expect(rolesAndAccessTab("reviews", ["changes", "reviews"])).toBe("reviews")
        expect(rolesAndAccessTab(undefined, ["changes", "reviews"])).toBe("changes")
        expect(rolesAndAccessTab(undefined, ["reviews"])).toBe("reviews")
        // A notice's link to Changes to roles, for someone with only reviews.
        expect(rolesAndAccessTab("changes", ["reviews"])).toBe("reviews")
        expect(rolesAndAccessTab("reviews", ["changes"])).toBe("changes")
    })

    it("is in the side bar for whoever holds either", () => {
        const viewer = (...permissions: string[]): SideBarViewer => ({ superAdmin: false, can: holds(...permissions) as any, has: () => true, checkIn: false, companySettings: false, cashAdvances: false })
        const items = (v: SideBarViewer) => sideBarFor(v).flatMap(g => g.items)
        expect(items(viewer("employees.review_access"))).toContain("rolesAndAccess")
        expect(items(viewer("employees.assign_role"))).toContain("rolesAndAccess")
        expect(items(viewer("employees.request_role"))).not.toContain("rolesAndAccess")
    })

    it("asks the page's tabs of the viewer's permissions, and shows only theirs", () => {
        const page = read("app/(dashboard)/dashboard/roles-and-access/page.tsx")
        expect(page).toContain("const tabs = rolesAndAccessTabs(p => can(viewer, p))")
        expect(page).toContain(`if (accountRefusal(viewer) || viewer.role === "SUPER_ADMIN" || tabs.length === 0) return <AccessDenied />`)
        expect(page).toContain("<RolesAndAccessClient tabs={tabs} tab={rolesAndAccessTab(tab, tabs)} highlight={highlight ?? null} />")
        const client = read("app/(dashboard)/dashboard/roles-and-access/RolesAndAccessClient.tsx")
        expect(client).toContain("tabs.includes('changes')")
        expect(client).toContain("tabs.includes('reviews')")
    })
})
