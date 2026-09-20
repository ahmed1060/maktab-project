import { describe, it, expect } from "vitest"
import { buildUserWhereClause } from "./user-query"

/**
 * The employee list's boundary, finally exercisable.
 *
 * While this lived inline in the route it had no test that could fail. One was
 * attempted against the route's source — searching the scoping block for
 * 'ADMIN' — and it passed with the conditional around that line disabled,
 * because the string remained in dead code. Every assertion here runs the real
 * function instead.
 */

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'EMPLOYEE']
const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'OFFLINE', 'ARCHIVED']

const build = (session: any, qs = "", company?: string) =>
    buildUserWhereClause(session, new URLSearchParams(qs), company, ROLES, STATUSES)

const leader = { user: { id: "tl-1", role: "TEAM_LEADER", companyId: "co-1" } }
const admin = { user: { id: "a-1", role: "ADMIN", companyId: "co-1" } }
const superAdmin = { user: { id: "sa-1", role: "SUPER_ADMIN", companyId: null } }

const clause = (r: ReturnType<typeof build>) => {
    expect(r.empty, "expected a query, got the empty result").toBe(false)
    return (r as any).whereClause
}

describe("a Team Leader sees their team and themselves", () => {
    it("adds the team rule", () => {
        expect(clause(build(leader)).AND).toContainEqual({
            OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }],
        })
    })

    it("excludes Admins", () => {
        // This is the assertion the deleted source-level guard was trying to
        // make, and could not.
        expect(clause(build(leader)).role.notIn).toContain("ADMIN")
    })

    it("keeps Super Admins out as well", () => {
        const where = clause(build(leader))
        expect(where.role.notIn.includes("ADMIN") || where.role.not === "SUPER_ADMIN").toBe(true)
        expect(JSON.stringify(where)).toContain("SUPER_ADMIN")
    })

    it("stays inside their company", () => {
        expect(clause(build(leader)).companyId).toBe("co-1")
    })

    it("cannot reach another team by asking for it", () => {
        // The filter is a separate key from the scope, so the two intersect.
        // Replacing the scope is the F-03 shape and is what this prevents.
        const where = clause(build(leader, "teamLeaderId=tl-2"))
        expect(where.teamLeaderId).toBe("tl-2")
        expect(where.AND).toContainEqual({ OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] })
    })

    it("keeps the scope when a search is supplied", () => {
        // Search writes whereClause.OR. If the scope were written there too,
        // whichever ran last would win — and it must always be the scope.
        const where = clause(build(leader, "search=laila"))
        expect(where.OR).toHaveLength(5)
        expect(where.AND).toContainEqual({ OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] })
    })

    it("returns nothing rather than everything when they have no company", () => {
        expect(build({ user: { id: "tl-1", role: "TEAM_LEADER", companyId: null } }).empty).toBe(true)
    })
})

describe("the roles that are not narrowed", () => {
    it("an Admin gets their whole company", () => {
        const where = clause(build(admin))
        expect(where.companyId).toBe("co-1")
        expect(JSON.stringify(where.AND ?? [])).not.toContain("teamLeaderId")
        expect(where.role.notIn ?? []).not.toContain("ADMIN")
    })

    it("a Super Admin is scoped only when a company is requested", () => {
        expect(clause(build(superAdmin)).companyId).toBeUndefined()
        expect(clause(build(superAdmin, "", "co-9")).companyId).toBe("co-9")
    })

    it("an Admin with no company gets nothing rather than the platform", () => {
        expect(build({ user: { id: "a-1", role: "ADMIN", companyId: null } }).empty).toBe(true)
    })
})

describe("filters narrow and never widen", () => {
    it("a positive role filter still cannot surface a Super Admin", () => {
        const where = clause(build(admin, "role=SUPER_ADMIN"))
        // equals sits alongside the standing exclusion, so the two contradict
        // and the query matches nothing — rather than the filter winning.
        expect(where.role.equals).toBe("SUPER_ADMIN")
        expect(where.role.not).toBe("SUPER_ADMIN")
    })

    it("a role filter does not undo the team rule", () => {
        const where = clause(build(leader, "role=EMPLOYEE"))
        expect(where.role.notIn).toContain("ADMIN")
        expect(where.AND).toContainEqual({ OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] })
    })

    it("an unknown status matches nothing instead of being ignored", () => {
        expect(clause(build(admin, "status=Pending")).AND).toContainEqual({ id: "__no_match__" })
    })

    it("hides deleted users unless asked", () => {
        expect(clause(build(admin)).AND).toContainEqual({ status: { not: "DELETED" } })
        expect(clause(build(admin, "includeDeleted=true")).AND ?? [])
            .not.toContainEqual({ status: { not: "DELETED" } })
    })

    it("treats unassigned as a real value", () => {
        // Null, not absent. A bucket that cannot be selected stays invisible,
        // and unassigned people are the ones an Admin most needs to find.
        expect(clause(build(admin, "teamLeaderId=unassigned")).teamLeaderId).toBeNull()
    })
})
