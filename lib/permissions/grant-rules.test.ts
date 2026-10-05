import { describe, it, expect } from "vitest"
import { normalizeGrants, covers, grantRows } from "./grant-rules"
import { BUILT_IN_GRANTS } from "./built-in"

describe("normalizeGrants", () => {
    it("refuses a permission the catalogue does not know", () => {
        expect(normalizeGrants([{ permission: "payrol.view", scope: "COMPANY" }])).toEqual({ ok: false, errors: ["Unknown permission: payrol.view"] })
    })

    it("refuses a scope the permission cannot be granted at", () => {
        const v = normalizeGrants([{ permission: "payroll.approve", scope: "TEAM" }])
        expect(v.ok).toBe(false)
    })

    it("refuses one permission at two scopes", () => {
        const v = normalizeGrants([{ permission: "tasks.view", scope: "TEAM" }, { permission: "tasks.view", scope: "COMPANY" }])
        expect(v.ok).toBe(false)
    })

    it("adds what a grant is useless without, at its scope", () => {
        const v = normalizeGrants([{ permission: "payroll.approve", scope: "COMPANY" }])
        // payroll.approve implies payroll.view, which implies salary.view.
        expect(v).toEqual({ ok: true, grants: { "payroll.approve": "COMPANY", "payroll.view": "COMPANY", "salary.view": "COMPANY" } })
    })

    it("widens an implied grant held narrower, and never narrows one", () => {
        expect(normalizeGrants([
            { permission: "tasks.view", scope: "TEAM" },
            { permission: "tasks.review", scope: "COMPANY" },
        ])).toEqual({ ok: true, grants: { "tasks.view": "COMPANY", "tasks.review": "COMPANY" } })
        expect(normalizeGrants([
            { permission: "tasks.view", scope: "COMPANY" },
            { permission: "tasks.review", scope: "TEAM" },
        ])).toEqual({ ok: true, grants: { "tasks.view": "COMPANY", "tasks.review": "TEAM" } })
    })

    it("leaves every built-in role exactly as it is — they are already whole", () => {
        for (const [role, grants] of Object.entries(BUILT_IN_GRANTS)) {
            expect(normalizeGrants(grantRows(grants)), role).toEqual({ ok: true, grants })
        }
    })
})

describe("covers — you can only hand out what you hold", () => {
    it("at an equal or narrower scope", () => {
        expect(covers({ "tasks.view": "COMPANY" }, { "tasks.view": "TEAM" })).toBe(true)
        expect(covers({ "tasks.view": "TEAM" }, { "tasks.view": "COMPANY" })).toBe(false)
        expect(covers({ "tasks.view": "COMPANY" }, { "payroll.view": "COMPANY" })).toBe(false)
    })

    it("the built-in Admin covers the other built-in roles", () => {
        expect(covers(BUILT_IN_GRANTS.ADMIN, BUILT_IN_GRANTS.TEAM_LEADER)).toBe(true)
        expect(covers(BUILT_IN_GRANTS.ADMIN, BUILT_IN_GRANTS.EMPLOYEE)).toBe(true)
    })
})
