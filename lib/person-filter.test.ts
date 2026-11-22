import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"

vi.setConfig({ testTimeout: 120_000 })

/**
 * The person filter on the Obligations, Tasks, Costs and Requests lists
 * (UI_PLAN.md, 2026-11-22; PR 368), found in PR 367's walk-through: it asked
 * for the employee list, which only whoever may see employees can read, so a
 * role that sees one of those lists and not employees was refused on every
 * visit. It now asks only when the viewer may see employees, and the lists
 * don't show it otherwise.
 */

const state = { grants: new Set<string>(), keys: [] as (string | null)[] }
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: "EMPLOYEE" } } }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p) }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        return { data: key ? { data: { data: [{ id: "p1", firstName: "Noor", lastName: "Adel", role: "EMPLOYEE" }, { id: "a1", firstName: "Amal", lastName: "Farid", role: "ADMIN" }] } } : undefined }
    },
}))

beforeEach(() => {
    state.grants = new Set()
    state.keys = []
})

async function options(on = true) {
    const { useEmployeeOptions } = await import("@/components/filters/useEmployeeOptions")
    const Probe = () => h("pre", null, JSON.stringify(useEmployeeOptions(on)))
    return JSON.parse(renderToStaticMarkup(h(Probe)).replace(/^<pre>|<\/pre>$/g, "").replace(/&quot;/g, '"'))
}

describe("the person filter's options", () => {
    it("aren't asked for, and there are none, for a viewer who may not see employees", async () => {
        state.grants = new Set(["obligations.view"])
        expect(await options()).toBeNull()
        expect(state.keys.filter(Boolean)).toEqual([])
    })

    it("are All employees and the people, Admins left out, for a viewer who may see employees", async () => {
        state.grants = new Set(["employees.view"])
        expect(await options()).toEqual([{ value: "", label: "all_employees" }, { value: "p1", label: "Noor Adel" }])
        expect(state.keys.filter(Boolean)).toEqual(["/api/users?limit=1000"])
    })

    it("aren't asked for when the list says not to, as for someone who sees only their own", async () => {
        state.grants = new Set(["employees.view"])
        expect(await options(false)).toBeNull()
        expect(state.keys.filter(Boolean)).toEqual([])
    })
})

describe("each list shows the person filter only when it has people to offer", () => {
    const read = (path: string) => readFileSync(path, "utf8")
    const D = "app/(dashboard)/dashboard/"
    const LISTS: [string, string][] = [
        [D + "obligations/ObligationsClient.tsx", "assignee_label"],
        [D + "tasks/TasksClient.tsx", "assignee_label"],
        [D + "costs/CostsClient.tsx", "costs_col_employee"],
        [D + "requests/RequestsClient.tsx", "requests_col_who"],
    ]

    it.each(LISTS)("%s", (path, label) => {
        const source = read(path)
        expect(source).toMatch(new RegExp(`\\{employeeOptions && \\(\\s*<Field label=\\{t\\('${label}'\\)\\} hideLabel>`))
        expect(source).toContain("options={employeeOptions} />")
    })
})
