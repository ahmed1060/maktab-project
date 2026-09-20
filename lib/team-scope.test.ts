import { describe, it, expect } from "vitest"
import { scopesToTeam, teamMemberWhere, assignedToTeamWhere, assignedToReportsWhere, and } from "./team-scope"

describe("who gets narrowed", () => {
    it("narrows a team leader and nobody else", () => {
        expect(scopesToTeam("TEAM_LEADER")).toBe(true)
        expect(scopesToTeam("ADMIN")).toBe(false)
        expect(scopesToTeam("SUPER_ADMIN")).toBe(false)
        // An employee is narrowed to themselves, which is tighter than this
        // rule and applied separately.
        expect(scopesToTeam("EMPLOYEE")).toBe(false)
        expect(scopesToTeam(null)).toBe(false)
        expect(scopesToTeam(undefined)).toBe(false)
    })
})

describe("the rule itself", () => {
    it("is my team, and me", () => {
        expect(teamMemberWhere("tl-1")).toEqual({ OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] })
    })

    it("includes the leader themselves, which is not a courtesy", () => {
        // Without it a leader's own tasks, their own row in the employee list
        // and their own requests vanish from their own screens.
        const rule = teamMemberWhere("tl-1")
        expect(rule.OR).toContainEqual({ id: "tl-1" })
    })

    it("reaches assigned work through the assignees", () => {
        expect(assignedToTeamWhere("tl-1")).toEqual({
            assignees: { some: { OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] } },
        })
    })

    it("can ask for the team's work without the leader's own", () => {
        // The old "active tasks" view asked for `none: { id: me }` — everything
        // in the company that was not mine, which grew with the company and had
        // nothing to do with a team.
        expect(assignedToReportsWhere("tl-1")).toEqual({ assignees: { some: { teamLeaderId: "tl-1" } } })
    })
})

describe("a scope that a filter can replace is not a scope", () => {
    it("keeps both conditions instead of overwriting", () => {
        const where: any = {}
        and(where, { assignees: { some: { id: "me" } } })
        and(where, { assignees: { some: { id: "colleague" } } })
        // Both survive, so the query is the intersection. This is the whole
        // point: the second condition narrows, it does not replace. A plain
        // assignment here is how an employee could read a colleague's tasks by
        // adding ?employeeId= to the URL.
        expect(where.AND).toHaveLength(2)
        expect(where.AND[0]).toEqual({ assignees: { some: { id: "me" } } })
    })

    it("absorbs an AND that was already there, in either shape", () => {
        expect(and({ AND: [{ a: 1 }] } as any, { b: 2 }).AND).toEqual([{ a: 1 }, { b: 2 }])
        expect(and({ AND: { a: 1 } } as any, { b: 2 }).AND).toEqual([{ a: 1 }, { b: 2 }])
    })

    it("leaves unrelated keys alone", () => {
        const where: any = { companyId: "co-1", status: "OPEN" }
        and(where, { x: 1 })
        expect(where.companyId).toBe("co-1")
        expect(where.status).toBe("OPEN")
    })
})
