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
