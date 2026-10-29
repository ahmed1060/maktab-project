import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * A link to the Tasks or Costs page can carry `clientId` or `locationId`,
 * shared by someone who may pick them, to someone who may not. The list is
 * still narrowed by them, but there was no select for them, so Reset left
 * them in place and the Filters badge didn't count them (Codex on #100).
 * Each is kept as a hidden filter: no select, counted, and cleared by Reset.
 */

const who = { grants: [] as string[] }
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => who.grants.includes(p) }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: "EMPLOYEE", companyId: "c1" } } }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("swr", () => ({ default: () => ({ data: undefined, error: undefined, isLoading: false }) }))

beforeEach(() => { who.grants = [] })

async function filtersFor(picked: { clientId: string; locationId: string }) {
    const { usePlaceFilters } = await import("@/components/locations/usePlaceFilters")
    let result: any
    const Probe = () => { result = usePlaceFilters(picked); return null }
    renderToStaticMarkup(h(Probe))
    return result as import("@/components/locations/usePlaceFilters").ExtraFilter[]
}

describe("a client or location in the address its viewer can't pick", () => {
    it("is a hidden filter, so Reset clears it", async () => {
        const filters = await filtersFor({ clientId: "k1", locationId: "loc-1" })
        expect(filters.map(f => [f.key, f.value, f.hidden])).toEqual([["clientId", "k1", true], ["locationId", "loc-1", true]])
    })

    it("is hidden only where it's not picked from a select", async () => {
        who.grants = ["clients.view"]
        const filters = await filtersFor({ clientId: "k1", locationId: "loc-1" })
        expect(filters.map(f => [f.key, !!f.hidden])).toEqual([["clientId", false], ["locationId", true]])
    })

    it("isn't there when the address doesn't set it", async () => {
        expect(await filtersFor({ clientId: "", locationId: "" })).toEqual([])
    })

    it("is counted on the Filters badge", async () => {
        const { default: EmployeeFilter } = await import("@/components/EmployeeFilter")
        const filters = await filtersFor({ clientId: "k1", locationId: "loc-1" })
        const html = renderToStaticMarkup(h(EmployeeFilter, {
            onFilterChange: () => {}, selectedEmployeeId: "", dateFrom: "", dateTo: "",
            hideEmployeeFilter: true, extraFilters: filters,
        }))
        expect(html).toMatch(/>2<\/span>/)
    })
})
