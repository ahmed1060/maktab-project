import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The Locations page (CLIENTS_PLAN.md §2.4, DESIGN.md §5): who sees it, what
 * it says when it can't show the list, and how each location reads: its
 * client or "Shared", its client's HQ marked, and one with no pin yet said
 * so, as no task can use it until it has one.
 */

type Row = { id: string; name: string; isHq: boolean; latitude: number | null; longitude: number | null; radiusMeters: number | null; archivedAt: string | null; createdAt: string; client: { id: string; name: string } | null; company: { name: string } }

const state = {
    role: "ADMIN",
    grants: new Set(["locations.view", "locations.add", "locations.manage", "clients.view"]),
    keys: [] as string[],
    rows: [] as Row[],
    failed: false,
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role } } }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p) }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (key: string) => key, icon: () => "🗺️" }) }))
vi.mock("swr", () => ({
    default: (key: [string, string] | null) => {
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (!key) return idle
        state.keys.push(key[0])
        if (key[0].startsWith("/api/locations")) {
            return state.failed
                ? { ...idle, error: new Error("Request failed") }
                : { ...idle, data: { scope: key[1], url: key[0], body: { data: { data: state.rows, total: state.rows.length, totalPages: state.rows.length ? 1 : 0 } } } }
        }
        return { ...idle, data: { scope: key[1], url: key[0], body: { data: [{ id: "c1", name: "Acme" }] } } }
    },
}))

const row = (over: Partial<Row>): Row => ({
    id: "l1", name: "Main office", isHq: false, latitude: 30.0444, longitude: 31.2357, radiusMeters: null, archivedAt: null,
    createdAt: "2026-10-22T00:00:00.000Z", client: { id: "c1", name: "Acme" }, company: { name: "Nizmo" }, ...over,
})

beforeEach(() => {
    state.role = "ADMIN"
    state.grants = new Set(["locations.view", "locations.add", "locations.manage", "clients.view"])
    state.keys = []
    state.rows = []
    state.failed = false
})

async function page() {
    const { default: LocationsPage } = await import("@/app/(dashboard)/dashboard/locations/page")
    return renderToStaticMarkup(h(LocationsPage))
}

describe("the Locations page", () => {
    it("tells someone who may not see locations so, without asking for them", async () => {
        state.role = "EMPLOYEE"
        state.grants = new Set()
        const html = await page()
        expect(html).toContain("Access Restricted")
        expect(state.keys).toEqual([])
    })

    it("says the list didn't load, with Try again, rather than that there are none", async () => {
        state.failed = true
        const html = await page()
        expect(html).toContain("locations_load_failed")
        expect(html).toContain("try_again")
        expect(html).not.toContain("locations_none")
    })

    it("offers to add the first location to whoever may", async () => {
        const html = await page()
        expect(html).toContain("locations_none")
        expect(html).toContain("locations_add")
        state.grants = new Set(["locations.view"])
        expect(await page()).not.toContain("locations_add")
    })

    it("marks a client's HQ, names a shared one so, and says which have no pin yet", async () => {
        state.rows = [
            row({ id: "hq", name: "Head office", isHq: true }),
            row({ id: "site", name: "Warehouse", latitude: null, longitude: null }),
            row({ id: "shared", name: "Port gate", client: null, radiusMeters: 250 }),
        ]
        const html = await page()
        expect(html).toContain("locations_hq")
        expect(html).toContain('href="/dashboard/clients/c1"')
        expect(html).toContain("locations_shared")
        expect(html.match(/locations_needs_pin/g)?.length).toBe(2) // the table's and the phone card's
        expect(html).toContain("https://www.google.com/maps/search/?api=1&amp;query=30.0444,31.2357")
        expect(html).toContain("locations_radius_default")
        expect(html).toContain("locations_radius_value")
    })

    it("offers the clients to filter by only to whoever may see them", async () => {
        await page()
        expect(state.keys).toContain("/api/clients")
        state.keys = []
        state.grants = new Set(["locations.view"])
        await page()
        expect(state.keys).not.toContain("/api/clients")
    })
})

describe("the place fields", () => {
    it("show a place someone may not change as it is, with no place search or map to move it", async () => {
        const { default: PlaceFields } = await import("@/components/locations/PlaceFields")
        const props = { draft: { name: "Main office", point: "30.0444, 31.2357", radius: "120" }, onChange: () => {}, errors: {} }
        const open = renderToStaticMarkup(h(PlaceFields, props))
        expect(open).toContain("location_search")
        expect(open).toContain("att_loc_here")
        expect(open.match(/<input[^>]*disabled=""/g)).toBeNull()

        const locked = renderToStaticMarkup(h(PlaceFields, { ...props, locked: true }))
        expect(locked).not.toContain("location_search")
        expect(locked).not.toContain("att_loc_here")
        expect(locked.match(/<input[^>]*disabled=""/g)).toHaveLength(3)
        expect(locked).toContain('value="Main office"')
    })
})
