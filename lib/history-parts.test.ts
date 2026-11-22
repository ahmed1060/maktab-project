import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { moduleForApiPath } from "./features/routes"
import { forPerson, historyParts } from "./history-parts"
import { permissionsOf } from "./useCan"
import { encodeGrants } from "./permissions/grants"

/**
 * What an employee's history asks for and shows each viewer
 * (LATER_CHANGES_PLAN.md §5.3; PR 370), found by the list of needs: the page
 * asked for the person, their day off and their costs whatever the viewer
 * held, so someone who may see salaries alone got two tabs that said they
 * didn't load, and the History link on the Employees list was offered by
 * "See salaries" alone though its tabs are for day off, costs, debts and
 * settlements too. Each part is now asked for only when its route answers
 * the viewer, and the tabs are those parts.
 */

const ALL = () => true
const holding = (...held: string[]) => (p: string) => held.includes(p)
const PARTS = ["months", "adjustments", "settlements", "debts", "dayOff", "costs"] as const
const on = (parts: ReturnType<typeof historyParts>) => PARTS.filter(k => parts[k])

describe("one's own history", () => {
    it("is the person, the months, the day off and the costs, holding nothing", () => {
        const parts = historyParts({ own: true, can: holding(), has: ALL })
        expect(on(parts)).toEqual(["months", "dayOff", "costs"])
        expect(parts.tabs).toEqual(["salary", "day-off", "costs"])
    })

    it("has the bonuses, settlements and debts only with what their routes ask, as anyone's", () => {
        expect(on(historyParts({ own: true, can: holding("salary.view", "settlements.manage", "debts.view"), has: ALL })))
            .toEqual(["months", "adjustments", "settlements", "debts", "dayOff", "costs"])
    })
})

describe("someone else's history", () => {
    it.each([
        [[], [], []],
        [["employees.view"], [], []],
        [["salary.view"], ["months", "adjustments"], ["salary"]],
        [["debts.view"], ["debts"], ["salary"]],
        [["settlements.manage"], ["settlements"], ["salary"]],
        [["dayoff.view"], ["dayOff"], ["day-off"]],
        [["costs.view"], ["costs"], ["costs"]],
        [["employees.view", "salary.view", "dayoff.view", "costs.view", "debts.view", "settlements.manage"], [...PARTS], ["salary", "day-off", "costs"]],
    ])("holding %j, asks for %j and shows %j", (held, parts, tabs) => {
        const got = historyParts({ own: false, can: holding(...held), has: ALL })
        expect(on(got)).toEqual(parts)
        expect(got.tabs).toEqual(tabs)
    })
})

describe("the company's package", () => {
    const everything = holding("employees.view", "salary.view", "dayoff.view", "costs.view", "debts.view", "settlements.manage")

    it("leaves out the day off without Day off, and its tab", () => {
        const parts = historyParts({ own: true, can: everything, has: m => m !== "DAY_OFF" })
        expect(parts.dayOff).toBe(false)
        expect(parts.tabs).toEqual(["salary", "costs"])
    })

    it("leaves out the bonuses and deductions without Salary adjustments, and keeps the months", () => {
        const parts = historyParts({ own: false, can: everything, has: m => m !== "SALARY_ADJUSTMENTS" })
        expect(parts.adjustments).toBe(false)
        expect(parts.months).toBe(true)
    })

    it("leaves out the months, costs, debts and settlements without Payroll", () => {
        const parts = historyParts({ own: false, can: everything, has: m => m !== "PAYROLL" })
        expect(on(parts)).toEqual(["adjustments", "dayOff"])
        expect(parts.tabs).toEqual(["salary", "day-off"])
    })
})

describe("each part asks what its route asks", () => {
    const route = (path: string) => stripComments(readFileSync(`app/api/users/${path}/route.ts`, "utf8"))

    it("the person: one's own, or See employees, kept to the team where that's held for one", () => {
        expect(route("")).toContain('if (userId !== session.user.id && !can(session.user, "employees.view"))')
        expect(route("")).toContain("const hasAccess = await verifyResourceAccess(session, userId, 'USER')")
    })

    it("held for a team, checked against the person, and only See employees, See salaries and See leave requests can be", () => {
        expect(route("[id]/salary-history")).toContain('if (!person || !can(session.user, "salary.view", person))')
        expect(route("[id]/day-off-history")).toContain('if (!person || !can(session.user, "dayoff.view", person))')
        expect(route("[id]/adjustments")).toContain('if (!person || !can(session.user, "salary.view", person))')
        for (const path of ["[id]/salary-history", "[id]/day-off-history", "[id]/costs-history", "[id]/adjustments", "[id]/settlements"]) {
            expect(route(path)).toContain("verifyResourceAccess(session,")
        }
        const security = stripComments(readFileSync("lib/security.ts", "utf8"))
        expect(security).toContain('if (teamOnly("employees.view")) {')
    })

    it.each([
        ["[id]/salary-history", 'if (!isSelf && !can(session.user, "salary.view"))', "PAYROLL"],
        ["[id]/day-off-history", 'if (!isSelf && !can(session.user, "dayoff.view"))', "DAY_OFF"],
        ["[id]/costs-history", 'if (!isSelf && !can(session.user, "costs.view"))', "PAYROLL"],
        ["[id]/adjustments", 'if (!can(session.user, "salary.view"))', "SALARY_ADJUSTMENTS"],
        ["[id]/settlements", 'if (!can(session.user, "settlements.manage"))', "PAYROLL"],
        ["[id]/debts", 'if (!managesCompany(session.user, "debts.view", user.companyId))', "PAYROLL"],
    ])("%s: %s, in %s", (path, rule, module) => {
        expect(route(path)).toContain(rule)
        expect(moduleForApiPath(`/api/users/u2/${path.slice(5)}`)).toBe(module)
    })
})

describe("what the viewer holds for the person (Codex on PR 370)", () => {
    // A grant held for a team reaches only the people it leads, as the routes
    // check it against the person: the History link and its tabs ask the same.
    const ME = "me"
    const viewer = (grants: Record<string, "TEAM" | "COMPANY">) => permissionsOf({
        role: "EMPLOYEE", id: ME, companyId: "c1",
        grants: encodeGrants(grants as never),
    } as never)
    const led = { userId: "p1", teamLeaderId: ME, companyId: "c1" }
    const other = { userId: "p2", teamLeaderId: "someone-else", companyId: "c1" }
    const parts = (grants: Record<string, "TEAM" | "COMPANY">, person: typeof led | null) => on(historyParts({ own: false, can: forPerson(viewer(grants), person), has: ALL }))

    it("a day off held for a team: only for the people it leads, and not before the person is known", () => {
        const grants = { "employees.view": "COMPANY", "dayoff.view": "TEAM" } as const
        expect(parts(grants, led)).toEqual(["dayOff"])
        expect(parts(grants, other)).toEqual([])
        expect(parts(grants, null)).toEqual([])
    })

    it("a salary held for a team: the months and the bonuses only for its people", () => {
        const grants = { "employees.view": "COMPANY", "salary.view": "TEAM" } as const
        expect(parts(grants, led)).toEqual(["months", "adjustments"])
        expect(parts(grants, other)).toEqual([])
    })

    it("one held for the company: anyone's, before the person is known too", () => {
        const grants = { "employees.view": "COMPANY", "costs.view": "COMPANY", "debts.view": "COMPANY" } as const
        expect(parts(grants, other)).toEqual(["debts", "costs"])
        expect(parts(grants, null)).toEqual(["debts", "costs"])
    })

    it("See employees held for a team keeps all of someone else's history to that team", () => {
        const grants = { "employees.view": "TEAM", "costs.view": "COMPANY", "settlements.manage": "COMPANY" } as const
        expect(parts(grants, led)).toEqual(["settlements", "costs"])
        expect(parts(grants, other)).toEqual([])
        expect(parts(grants, null)).toEqual([])
    })

    it("without See employees, nothing is kept to a team", () => {
        expect(parts({ "costs.view": "COMPANY" }, other)).toEqual(["costs"])
    })
})
