import { describe, it, expect } from "vitest"
import { PERMISSIONS, ALL_PERMISSIONS, isPermission, type Permission, type Scope } from "./catalogue"
import { BUILT_IN_GRANTS, type BuiltInRole } from "./built-in"
import { can, grantFor, withinScope } from "./can"
import { withGrants } from "@/lib/permissions/test-actors"

const ROLES = Object.keys(BUILT_IN_GRANTS) as BuiltInRole[]
const WIDTH: Record<Scope, number> = { OWN: 0, TEAM: 1, COMPANY: 2 }

describe("the catalogue is internally consistent", () => {
    it("every implied permission exists", () => {
        for (const p of ALL_PERMISSIONS) {
            for (const implied of (PERMISSIONS[p] as any).implies ?? []) {
                expect(isPermission(implied), `${p} implies unknown ${implied}`).toBe(true)
            }
        }
    })

    it("every permission may be granted at some scope", () => {
        for (const p of ALL_PERMISSIONS) expect(PERMISSIONS[p].scopes.length, p).toBeGreaterThan(0)
    })

    it("no approval-type permission is offered at OWN scope", () => {
        // Nobody may approve their own request, so an OWN grant would look
        // configured and do nothing.
        for (const p of ALL_PERMISSIONS.filter(p => /\.(approve|review|waive)$/.test(p))) {
            expect(PERMISSIONS[p].scopes as readonly Scope[], p).not.toContain("OWN")
        }
    })
})

describe("the built-in grants are ones the catalogue allows", () => {
    for (const role of ROLES) {
        it(`${role} holds only allowed scopes`, () => {
            for (const [p, scope] of Object.entries(BUILT_IN_GRANTS[role])) {
                expect(isPermission(p), p).toBe(true)
                expect(PERMISSIONS[p as Permission].scopes as readonly Scope[], `${role} ${p}`).toContain(scope)
            }
        })

        it(`${role} holds everything its grants imply, at least as widely`, () => {
            // A role that can approve payroll but not see it would half-work.
            for (const [p, scope] of Object.entries(BUILT_IN_GRANTS[role]) as [Permission, Scope][]) {
                for (const implied of ((PERMISSIONS[p] as any).implies ?? []) as Permission[]) {
                    const held = BUILT_IN_GRANTS[role][implied]
                    expect(held, `${role}: ${p} implies ${implied}`).toBeDefined()
                    expect(WIDTH[held!], `${role}: ${implied} narrower than ${p}`).toBeGreaterThanOrEqual(WIDTH[scope])
                }
            }
        })
    }
})

describe("can", () => {
    const admin = withGrants({ id: "a", role: "ADMIN", companyId: "c1" })
    const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null }

    it("gives a Super Admin everything, anywhere", () => {
        for (const p of ALL_PERMISSIONS) {
            expect(grantFor(superAdmin, p)).toBe("ALL")
            expect(can(superAdmin, p, { companyId: "c9" })).toBe(true)
        }
    })

    it("holds an Admin to their own company", () => {
        expect(can(admin, "payroll.approve", { companyId: "c1" })).toBe(true)
        expect(can(admin, "payroll.approve", { companyId: "c2" })).toBe(false)
    })

    it("refuses what a role was not granted", () => {
        expect(can(withGrants({ id: "e", role: "EMPLOYEE", companyId: "c1" }), "payroll.view", { companyId: "c1" })).toBe(false)
        expect(can(withGrants({ id: "t", role: "TEAM_LEADER", companyId: "c1" }), "debts.waive")).toBe(false)
    })

    it("refuses an unknown or missing role", () => {
        for (const role of ["", null, undefined, "OWNER", "admin"]) {
            expect(can({ id: "x", role, companyId: "c1" }, "payroll.view", { companyId: "c1" }), String(role)).toBe(false)
        }
    })

    it("refuses a company-scoped actor with no company, rather than matching a target with none", () => {
        expect(can(withGrants({ id: "a", role: "ADMIN", companyId: null }), "payroll.view", { companyId: null })).toBe(false)
    })

    it("without a target, says whether the permission is held at all", () => {
        expect(can(admin, "payroll.view")).toBe(true)
        expect(can(withGrants({ id: "e", role: "EMPLOYEE", companyId: "c1" }), "payroll.view")).toBe(false)
    })
})

describe("scope rules", () => {
    const leader = withGrants({ id: "tl", role: "TEAM_LEADER", companyId: "c1" })

    it("COMPANY: anything in the company", () => {
        expect(withinScope("COMPANY", leader, { companyId: "c1" })).toBe(true)
        expect(withinScope("COMPANY", leader, { companyId: "c2" })).toBe(false)
    })

    it("TEAM: themselves and their reports, in their company", () => {
        expect(withinScope("TEAM", leader, { companyId: "c1", userId: "tl" })).toBe(true)
        expect(withinScope("TEAM", leader, { companyId: "c1", userId: "e1", teamLeaderId: "tl" })).toBe(true)
        expect(withinScope("TEAM", leader, { companyId: "c1", userId: "e2", teamLeaderId: "tl-2" })).toBe(false)
        expect(withinScope("TEAM", leader, { companyId: "c1", userId: "e3", teamLeaderId: null })).toBe(false)
        expect(withinScope("TEAM", leader, { companyId: "c2", userId: "e1", teamLeaderId: "tl" })).toBe(false)
    })

    it("TEAM: refuses a target with no person rather than guessing", () => {
        expect(withinScope("TEAM", leader, { companyId: "c1" })).toBe(false)
    })

    it("OWN: only themselves", () => {
        expect(withinScope("OWN", leader, { companyId: "c1", userId: "tl" })).toBe(true)
        expect(withinScope("OWN", leader, { companyId: "c1", userId: "e1", teamLeaderId: "tl" })).toBe(false)
    })
})

describe("canCompanyWide", () => {
    it("is true for a Super Admin and for a COMPANY grant", async () => {
        const { canCompanyWide } = await import("./can")
        expect(canCompanyWide({ id: "sa", role: "SUPER_ADMIN" }, "obligations.manage")).toBe(true)
        expect(canCompanyWide(withGrants({ id: "a", role: "ADMIN", companyId: "c1" }), "obligations.manage")).toBe(true)
    })

    it("is false for a TEAM grant, and for no grant at all", async () => {
        const { canCompanyWide } = await import("./can")
        expect(canCompanyWide(withGrants({ id: "t", role: "TEAM_LEADER", companyId: "c1" }), "obligations.manage")).toBe(false)
        expect(canCompanyWide(withGrants({ id: "e", role: "EMPLOYEE", companyId: "c1" }), "obligations.manage")).toBe(false)
    })
})
