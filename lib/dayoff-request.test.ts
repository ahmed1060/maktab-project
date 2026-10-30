import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, type Permission } from "@/lib/permissions/catalogue"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * Asking for leave, a permission of its own (UI_PLAN.md §2.3, part 2a,
 * decided on 2026-10-30): a role is given it or not in the role editor, as
 * the Requests page offers a day off only to those who may ask for one.
 */

const ASK = "dayoff.request" as Permission

describe("asking for leave", () => {
    it("is a permission in the catalogue, under Day off", () => {
        expect(PERMISSIONS[ASK]).toMatchObject({ code: 65, module: "DAY_OFF" })
        // Only ever one's own: the role editor says "Own", not "Whole company".
        expect(PERMISSIONS[ASK].scopes).toEqual(["OWN"])
    })

    it("is held by the built-in Employee and Team Leader, as they ask today, and not the Admin", () => {
        expect(BUILT_IN_GRANTS.EMPLOYEE[ASK as keyof typeof BUILT_IN_GRANTS.EMPLOYEE]).toBe("OWN")
        expect(BUILT_IN_GRANTS.TEAM_LEADER[ASK as keyof typeof BUILT_IN_GRANTS.TEAM_LEADER]).toBe("OWN")
        expect(BUILT_IN_GRANTS.ADMIN[ASK as keyof typeof BUILT_IN_GRANTS.ADMIN]).toBeUndefined()
    })

    it("is a row of the role editor's Day off group, named in both languages", () => {
        expect(PERMISSION_GROUPS.find(g => g.key === "dayoff")?.permissions).toContain(ASK)
        expect((en as Record<string, string>).perm_dayoff_request).toBe("Ask for leave")
        expect((ar as Record<string, string>).perm_dayoff_request).toBeTruthy()
    })

    it("reaches the companies already there in 2b's migration, run once 2a's role editor was live", () => {
        expect(readFileSync("lib/roles-migration.test.ts", "utf8")).toContain("prisma/migrations/20261124000000_dayoff_request_granted/migration.sql")
    })
})
