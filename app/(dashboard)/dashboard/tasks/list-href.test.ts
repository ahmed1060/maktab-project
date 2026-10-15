import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { tasksListHref } from "./list-href"

/**
 * The dashboard's task numbers link to the tasks they count. A Team Leader's
 * count their team's tasks, their own among them, and the Tasks page opened
 * a Team Leader on their own tasks alone.
 */

const dashboard = readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
const tasks = readFileSync("app/(dashboard)/dashboard/tasks/page.tsx", "utf8")

describe("a link to the tasks a dashboard number counts", () => {
    it("asks for the team's view for someone who sees a team's tasks", () => {
        expect(tasksListHref({ teamOnly: true, status: "IN_PROGRESS" })).toBe("/dashboard/tasks?view=team&status=IN_PROGRESS")
        expect(tasksListHref({ teamOnly: true })).toBe("/dashboard/tasks?view=team")
    })

    it("is the plain list for everyone else, whose list is what they're counted", () => {
        expect(tasksListHref({ teamOnly: false, status: "PENDING" })).toBe("/dashboard/tasks?status=PENDING")
        expect(tasksListHref({ teamOnly: false })).toBe("/dashboard/tasks")
    })

    it("is every task link on the dashboard", () => {
        expect(dashboard).toContain("href: tasksListHref({ status, teamOnly: tasksTeamOnly })")
        expect(dashboard).toContain("href: tasksListHref({ teamOnly: tasksTeamOnly })")
        expect(dashboard).toContain("href: tasksListHref({ status: 'PENDING_CONFIRMATION', teamOnly: tasksTeamOnly })")
        expect(dashboard).not.toMatch(/href: ['`]\/dashboard\/tasks[?'`]/)
        expect(dashboard).toContain("const tasksTeamOnly = grantFor(viewer, 'tasks.view') === 'TEAM'")
    })
})

describe("the Tasks page's team view", () => {
    it("is the tasks the dashboard counts for a team: the team's, the leader's own among them", () => {
        // The same rule as the dashboard's count.
        expect(dashboard).toContain("and(baseWhere, assignedToTeamWhere(userId))")
        expect(tasks).toMatch(/\} else if \(view === 'team'\) \{[\s\S]*?and\(whereClause, assignedToTeamWhere\(userId\)\)/)
    })

    it("is only within a team scope: an employee's list stays their own", () => {
        const team = tasks.indexOf("} else if (scope === 'TEAM') {")
        const company = tasks.indexOf("} else if (scope === 'COMPANY') {")
        const at = tasks.indexOf("} else if (view === 'team') {")
        expect(at).toBeGreaterThan(team)
        expect(at).toBeLessThan(company)
    })
})
