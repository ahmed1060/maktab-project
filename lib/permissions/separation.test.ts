import { describe, it, expect } from "vitest"
import { SEPARATION_OF_DUTIES, conflictsIn, newConflicts } from "./separation"
import { PERMISSIONS } from "./catalogue"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import { BUILT_IN_GRANTS } from "./built-in"

describe("separation of duties", () => {
    it("names only permissions that exist, and says why in both languages", () => {
        for (const { pair, key } of SEPARATION_OF_DUTIES) {
            for (const p of pair) expect(PERMISSIONS).toHaveProperty(p)
            expect(en).toHaveProperty(`sod_${key}`)
            expect(ar).toHaveProperty(`sod_${key}`)
        }
    })

    it("finds a role holding both halves", () => {
        expect(conflictsIn({ "payroll.prepare": "COMPANY", "payroll.approve": "COMPANY" })).toEqual(["prepare_approve_payroll"])
        expect(conflictsIn({ "payroll.prepare": "COMPANY" })).toEqual([])
    })

    it("asks again only about what a change adds", () => {
        const before = { "payroll.prepare": "COMPANY", "payroll.approve": "COMPANY" } as const
        expect(newConflicts(before, { ...before, "salary.edit": "COMPANY" })).toEqual(["salary_approve_payroll"])
        expect(newConflicts(before, before)).toEqual([])
    })

    // The built-in Admin holds everything, so every pair — which is why it is
    // locked and a company wanting less gets a narrower Admin-based role.
    it("the built-in Admin holds every pair; the others none", () => {
        expect(conflictsIn(BUILT_IN_GRANTS.ADMIN)).toHaveLength(SEPARATION_OF_DUTIES.length)
        expect(conflictsIn(BUILT_IN_GRANTS.TEAM_LEADER)).toEqual([])
        expect(conflictsIn(BUILT_IN_GRANTS.EMPLOYEE)).toEqual([])
    })
})
