import { describe, it, expect } from "vitest"
import { buildTaskWhereClause } from "./task-query"

function params(query: Record<string, string> = {}) {
    return new URLSearchParams(query)
}

describe("buildTaskWhereClause (F-03 tenancy scoping)", () => {
    it("scopes an employee to their own tasks, ignoring an employeeId filter", () => {
        const session = { user: { id: "emp-1", role: "EMPLOYEE", companyId: "co-1" } }

        const result = buildTaskWhereClause(session, params({ employeeId: "someone-else" }), null)

        expect(result.empty).toBe(false)
        if (result.empty) return
        // The employeeId filter must never appear — an employee can only ever
        // be scoped to themselves, regardless of what the query string asks for.
        expect(result.whereClause).toEqual({
            AND: [{ assignees: { some: { id: "emp-1" } } }],
        })
    })

    it("never lets an employeeId filter replace the employee's own scope (regression for F-03)", () => {
        const session = { user: { id: "emp-1", role: "EMPLOYEE", companyId: "co-1" } }
        const result = buildTaskWhereClause(session, params({ employeeId: "victim-id" }), null)

        expect(result.empty).toBe(false)
        if (result.empty) return
        const serialized = JSON.stringify(result.whereClause)
        // "victim-id" must not leak into the query at all for an employee caller.
        expect(serialized).not.toContain("victim-id")
        expect(serialized).toContain("emp-1")
    })

    it("scopes an ADMIN to their own company and allows narrowing by employeeId", () => {
        const session = { user: { id: "admin-1", role: "ADMIN", companyId: "co-1" } }
        const result = buildTaskWhereClause(session, params({ employeeId: "emp-42" }), null)

        expect(result.empty).toBe(false)
        if (result.empty) return
        expect(result.whereClause.AND).toContainEqual({ companyId: "co-1" })
        expect(result.whereClause.AND).toContainEqual({ assignees: { some: { id: "emp-42" } } })
    })

    it("returns empty for an ADMIN with no companyId rather than scanning all companies", () => {
        const session = { user: { id: "admin-1", role: "ADMIN", companyId: null } }
        const result = buildTaskWhereClause(session, params(), null)
        expect(result.empty).toBe(true)
    })

    it("only scopes a SUPER_ADMIN by company when one is explicitly requested", () => {
        const session = { user: { id: "sa-1", role: "SUPER_ADMIN", companyId: null } }

        const unscoped = buildTaskWhereClause(session, params(), null)
        expect(unscoped.empty).toBe(false)
        if (!unscoped.empty) expect(unscoped.whereClause).toEqual({ AND: [] })

        const scoped = buildTaskWhereClause(session, params(), "co-9")
        expect(scoped.empty).toBe(false)
        if (!scoped.empty) expect(scoped.whereClause.AND).toContainEqual({ companyId: "co-9" })
    })

    it("applies status, search, and date filters additively alongside the scope", () => {
        const session = { user: { id: "admin-1", role: "ADMIN", companyId: "co-1" } }
        const result = buildTaskWhereClause(
            session,
            params({ status: "PENDING", search: "invoice", dateFrom: "2026-01-01", dateTo: "2026-01-31" }),
            null
        )

        expect(result.empty).toBe(false)
        if (result.empty) return
        expect(result.whereClause.AND).toContainEqual({ companyId: "co-1" })
        expect(result.whereClause.AND).toContainEqual({ status: "PENDING" })
        expect(result.whereClause.AND).toContainEqual(
            expect.objectContaining({
                OR: [
                    { title: { contains: "invoice", mode: "insensitive" } },
                    { description: { contains: "invoice", mode: "insensitive" } },
                ],
            })
        )
    })

    it("makes an invalid status value match nothing instead of reaching Postgres (F-13)", () => {
        // Task.status is a Postgres enum now — a value that isn't one of its
        // members would make Postgres reject the whole query ("invalid input
        // value for enum") instead of the harmless zero-match a plain String
        // column gave a garbage filter value.
        const session = { user: { id: "admin-1", role: "ADMIN", companyId: "co-1" } }
        const result = buildTaskWhereClause(session, params({ status: "NOT_A_REAL_STATUS" }), null)

        expect(result.empty).toBe(false)
        if (result.empty) return
        expect(result.whereClause.AND).toContainEqual({ id: "__no_match__" })
        expect(JSON.stringify(result.whereClause)).not.toContain("NOT_A_REAL_STATUS")
    })
})

describe("a Team Leader is scoped to their team", () => {
    /**
     * Every assertion below is new. This function treated ADMIN and
     * TEAM_LEADER as the same branch and only ADMIN was ever tested, so the
     * branch this whole feature turns on had no coverage at all — which is why
     * each of these was broken on purpose before being trusted.
     */
    const leader = { user: { id: "tl-1", role: "TEAM_LEADER", companyId: "co-1" } }

    it("asks for their own team and themselves, inside their company", () => {
        const r = buildTaskWhereClause(leader, new URLSearchParams(), null)
        expect(r.empty).toBe(false)
        const scope = (r as any).whereClause.AND
        expect(scope).toContainEqual({ companyId: "co-1" })
        expect(scope).toContainEqual({
            assignees: { some: { OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] } },
        })
    })

    it("cannot reach another team by supplying an employeeId", () => {
        // The filter is pushed alongside the scope, never over it, so asking
        // for somebody else's report intersects to nothing rather than
        // replacing the rule. This is F-03's shape, and the reason `scope` and
        // `filters` are separate arrays in this function.
        const r = buildTaskWhereClause(leader, new URLSearchParams("employeeId=other-team-member"), null)
        const clauses = (r as any).whereClause.AND
        expect(clauses).toContainEqual({
            assignees: { some: { OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] } },
        })
        expect(clauses).toContainEqual({ assignees: { some: { id: "other-team-member" } } })
    })

    it("returns empty rather than every company when they have none", () => {
        const orphan = { user: { id: "tl-1", role: "TEAM_LEADER", companyId: null } }
        expect(buildTaskWhereClause(orphan, new URLSearchParams(), null).empty).toBe(true)
    })

    it("still gives an ADMIN the whole company", () => {
        // The other half: narrowing the wrong role would quietly break the
        // people who are supposed to see everything.
        const admin = { user: { id: "a-1", role: "ADMIN", companyId: "co-1" } }
        const scope = (buildTaskWhereClause(admin, new URLSearchParams(), null) as any).whereClause.AND
        expect(scope).toContainEqual({ companyId: "co-1" })
        expect(JSON.stringify(scope)).not.toContain("teamLeaderId")
    })
})

describe("filtering work by team", () => {
    const admin = { user: { id: "a-1", role: "ADMIN", companyId: "co-1" } }

    it("asks for tasks with at least one assignee on that team", () => {
        const clauses = (buildTaskWhereClause(admin, new URLSearchParams("teamLeaderId=tl-1"), null) as any).whereClause.AND
        expect(clauses).toContainEqual({ assignees: { some: { teamLeaderId: "tl-1" } } })
    })

    it("treats unassigned as a real value", () => {
        // Work assigned to people nobody manages is visible to no team leader,
        // so an Admin is the only one who can find it — and only if it is
        // reachable as a filter value rather than as the absence of one.
        const clauses = (buildTaskWhereClause(admin, new URLSearchParams("teamLeaderId=unassigned"), null) as any).whereClause.AND
        expect(clauses).toContainEqual({ assignees: { some: { teamLeaderId: null } } })
    })

    it("is a filter, so a task spanning two teams answers to both", () => {
        // The reason this is not a grouping. A task assigned to one person on
        // each of two teams belongs to both; a grouped view would have to
        // duplicate it or pick one arbitrarily. Two separate queries, each
        // matching, is the honest shape — and `some` is what makes that true.
        for (const team of ["tl-1", "tl-2"]) {
            const clauses = (buildTaskWhereClause(admin, new URLSearchParams(`teamLeaderId=${team}`), null) as any).whereClause.AND
            expect(clauses).toContainEqual({ assignees: { some: { teamLeaderId: team } } })
        }
    })

    it("cannot widen a Team Leader's scope", () => {
        // A leader asking for another team gets the intersection of "my team"
        // and "their team", which is empty — not the other team's work.
        const leader = { user: { id: "tl-1", role: "TEAM_LEADER", companyId: "co-1" } }
        const clauses = (buildTaskWhereClause(leader, new URLSearchParams("teamLeaderId=tl-2"), null) as any).whereClause.AND
        expect(clauses).toContainEqual({ assignees: { some: { OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] } } })
        expect(clauses).toContainEqual({ assignees: { some: { teamLeaderId: "tl-2" } } })
    })
})
