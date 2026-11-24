import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { employeesListUrl } from "./list-query"

/**
 * The Employees list is paged, so its filters and sort have to reach the
 * server. The role filter used to be kept on the screen and never sent, so
 * picking "Team Leader" changed nothing; the sort reordered only the ten
 * people on the page in view.
 */

const base = { page: 2, limit: 10, teamOnly: false }
const params = (url: string) => new URL(url, "http://x").searchParams

describe("the Employees list asks the server for", () => {
    it("the role picked", () => {
        expect(params(employeesListUrl({ ...base, role: "TEAM_LEADER" })).get("role")).toBe("TEAM_LEADER")
        expect(params(employeesListUrl(base)).has("role")).toBe(false)
    })

    it("the sort and its direction", () => {
        const p = params(employeesListUrl({ ...base, sort: "points", order: "desc" }))
        expect([p.get("sort"), p.get("order")]).toEqual(["points", "desc"])
    })

    it("the page, the search, the status and the team, as before", () => {
        const p = params(employeesListUrl({ ...base, companyId: "c1", viewerId: "me", search: "sara", status: "ACTIVE", teamLeaderId: "unassigned" }))
        expect(Object.fromEntries(p)).toMatchObject({
            companyId: "c1", page: "2", limit: "10", excludeRole: "SUPER_ADMIN", excludeUserId: "me",
            search: "sara", status: "ACTIVE", teamLeaderId: "unassigned",
        })
    })

    it("no Admins for someone who sees only a team", () => {
        expect(params(employeesListUrl({ ...base, teamOnly: true })).get("excludeRole")).toBe("ADMIN,SUPER_ADMIN")
    })
})

describe("the Employees page", () => {
    const page = readFileSync("app/(dashboard)/dashboard/employees/page.tsx", "utf8")

    it("builds its request here, and doesn't re-sort in the browser", () => {
        expect(page).toContain("employeesListUrl(listQuery)")
        expect(page).not.toMatch(/\.sort\(\(a, b\)/)
    })
})

// Employees' names in the page's language (LATER_CHANGES_PLAN.md §3.1, step 5, PR 405).
describe("the Employees list asks for names", () => {
    it("missing a language, when that's what's shown", () => {
        expect(params(employeesListUrl({ ...base, names: "missing" })).get("names")).toBe("missing")
        expect(params(employeesListUrl(base)).has("names")).toBe(false)
    })

    it("counted, for whoever is told how many", () => {
        expect(params(employeesListUrl({ ...base, countNames: true })).get("counts")).toBe("names")
        expect(params(employeesListUrl(base)).has("counts")).toBe(false)
    })

    it("sorted in the page's language", () => {
        expect(params(employeesListUrl({ ...base, sort: "name", order: "asc", lang: "ar" })).get("lang")).toBe("ar")
        expect(params(employeesListUrl({ ...base, lang: "en" })).get("lang")).toBe("en")
    })
})
