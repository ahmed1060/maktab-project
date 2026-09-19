import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * An employee sees their own tasks, and their own costs.
 *
 * The tasks page offered two views to EMPLOYEE as well as TEAM_LEADER: "my
 * tasks", and the company's other work in flight. The second was meant for a
 * Team Leader. For an employee it answered `?view=active` with every
 * colleague's open task — and because the query uses `include`, the whole row
 * was serialised into the page, `memberCosts` among it. That is a map of
 * assignee to what they are paid for the task, so the payload carried each
 * colleague's per-task rate whether or not the screen drew it.
 *
 * Two separate things had to change, and only one of them is a real defence:
 * the page no longer builds that query for an employee at all, whatever the
 * query string says, and the tabs are no longer offered. Hiding the tab alone
 * would leave a typed URL working.
 */

const PAGE = stripComments(readFileSync("app/(dashboard)/dashboard/tasks/page.tsx", "utf8"))
const CLIENT = stripComments(readFileSync("app/(dashboard)/dashboard/tasks/TasksClient.tsx", "utf8"))
const DETAIL = stripComments(readFileSync("app/(dashboard)/dashboard/tasks/[id]/page.tsx", "utf8"))

/** The EMPLOYEE arm of the role branch. */
function employeeBranch(): string {
    const start = PAGE.indexOf("if (role === 'EMPLOYEE')")
    expect(start, "the EMPLOYEE branch is missing").toBeGreaterThan(-1)
    return PAGE.slice(start, PAGE.indexOf("role === 'TEAM_LEADER'", start))
}

describe("an employee only ever sees their own tasks", () => {
    const branch = employeeBranch()

    it("scopes to tasks assigned to them", () => {
        expect(branch).toMatch(/assignees\s*=\s*\{\s*some:\s*\{\s*id:\s*userId\s*\}/)
    })

    it("never asks for tasks assigned to somebody else", () => {
        // `none: { id: userId }` is the other-people's-work query. For an
        // employee it must not exist at all.
        expect(branch, "the employee branch still builds the colleagues' query")
            .not.toMatch(/assignees\s*=\s*\{\s*none:\s*\{\s*id:\s*userId\s*\}/)
    })

    it("does not branch on the requested view", () => {
        // The rule has to hold for a typed or bookmarked URL, not only for the
        // path the tabs take.
        expect(branch, "the employee branch still reads `view`").not.toMatch(/\bview\b/)
    })

    it("pins the view to 'my' regardless of the query string", () => {
        expect(PAGE).toMatch(/role === 'EMPLOYEE' \? 'my' :/)
    })
})

describe("the two tabs belong to a Team Leader", () => {
    it("is not offered to an employee", () => {
        expect(CLIENT).toMatch(/role === 'TEAM_LEADER' && \(/)
        expect(CLIENT, "the tab switcher is still rendered for EMPLOYEE")
            .not.toMatch(/\['EMPLOYEE', 'TEAM_LEADER'\]\.includes\(role\)/)
    })
})

describe("an employee's payload carries only their own cost", () => {
    it("narrows memberCosts before it leaves the server", () => {
        // TaskListItem only ever reads memberCosts[currentUserId], so nothing
        // else was on screen — it was in the HTML, which is the same
        // disclosure with an extra step.
        expect(PAGE).toMatch(/function visibleMemberCosts/)
        expect(PAGE).toMatch(/memberCosts:\s*visibleMemberCosts\(task\.memberCosts\)/)
        const fn = PAGE.slice(PAGE.indexOf("function visibleMemberCosts"))
        expect(fn).toMatch(/role !== 'EMPLOYEE'/)
        expect(fn, "it must keep the employee's own entry").toMatch(/\[userId\]:\s*parsed\[userId\]/)
    })
})

describe("the task detail page narrows it too", () => {
    it("does not ship the whole memberCosts map to an employee", () => {
        // Same class as the list. TaskCostsSection already shows an employee
        // only their own figure, but the map was serialised whole — so on a
        // three-assignee task any one of them could read the other two's rate
        // out of the page source.
        expect(DETAIL).toMatch(/visibleMemberCosts/)
        expect(DETAIL).toMatch(/memberCosts:\s*visibleMemberCosts/)
        const fn = DETAIL.slice(DETAIL.indexOf("const visibleMemberCosts"))
        expect(fn).toMatch(/userRole !== 'EMPLOYEE'/)
        expect(fn, "the employee's own entry must survive").toMatch(/\[userId\]:\s*parsed\[userId\]/)
    })

    it("still spreads the row, so a new sensitive column would be caught by review not by luck", () => {
        // Documenting the residual shape rather than claiming it is solved:
        // the page uses include + spread, so any column added to Task lands in
        // the payload by default. Narrowing is per-column and deliberate.
        expect(DETAIL).toMatch(/\.\.\.task/)
    })
})
