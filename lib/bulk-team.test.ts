import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { moduleForApiPath } from "./features"

const ROUTE = stripComments(readFileSync("app/api/users/team/route.ts", "utf8"))

/**
 * Bulk assignment, and the two ways a shortcut becomes the loose door.
 *
 * One is the gate: a new endpoint that nobody adds to the feature map ships
 * ungated, so a company on a package without the Employees module can still
 * call it. The other is the rule: a batch is exactly where a representative
 * check goes wrong, because the first row is an employee and the fourteenth
 * is a team leader.
 */

describe("the endpoint is gated like everything else under /api/users", () => {
    it("resolves to the Employees module", () => {
        // Behavioural, not a text search: this asks the same resolver the
        // request path asks at runtime.
        expect(moduleForApiPath("/api/users/team")).toBe("EMPLOYEES")
    })

    it("is gated with the module a company already buys, not a new one", () => {
        // A separate saleable module would mean a company could hold Team
        // Leader accounts whose access stays company-wide because they did not
        // buy the thing that narrows it — the weaker posture as the cheaper
        // one.
        expect(moduleForApiPath("/api/users/team")).not.toBe("SALARY_ADJUSTMENTS")
    })

    it("is matched before the per-user patterns, not swallowed as an id", () => {
        // /api/users/team would otherwise read as /api/users/[id] and resolve
        // to whatever that pattern says.
        expect(moduleForApiPath("/api/users/team")).not.toBe(moduleForApiPath("/api/users/abc123/payslips"))
    })

    it("admits only Admins", () => {
        // Declared as a permission now (ROLES_PLAN.md, Part A); which built-in
        // roles hold it is lib/permissions/built-in.ts, recorded in
        // lib/permissions/employee-access.characterization.test.ts.
        expect(ROUTE).toMatch(/permission:\s*"employees\.assign_team"/)
    })
})

describe("the shortcut is not looser than the long way round", () => {
    it("checks every target, not a representative one", () => {
        expect(ROUTE).toMatch(/for \(const target of targets\)/)
        expect(ROUTE).toContain("checkTeamAssignment(target, leader)")
    })

    it("uses the same rule the single-employee path uses", () => {
        // Not a reimplementation of it. A second copy is how the two drift.
        expect(ROUTE).toContain('from "@/lib/team-assignment"')
    })

    it("refuses a batch containing somebody from another company", () => {
        expect(ROUTE).toMatch(/targets\.some\(t => t\.companyId !== companyId\)/)
    })

    it("dedupes before comparing counts", () => {
        // A repeated id would otherwise pad the list and make a short set of
        // rows look like a complete one.
        expect(ROUTE).toMatch(/new Set\(userIds\)/)
    })

    it("caps the batch size", () => {
        expect(ROUTE).toMatch(/\.max\(\d+\)/)
    })

    it("writes and records together", () => {
        // A bulk permission change that is not in the audit log is the one
        // most worth having there.
        const tx = ROUTE.slice(ROUTE.indexOf("$transaction"))
        expect(tx).toContain("updateMany")
        expect(tx).toContain("REASSIGN_TEAM")
        expect(tx).toMatch(/tx,/)
    })
})
