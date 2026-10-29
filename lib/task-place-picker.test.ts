import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"

/**
 * A task's client and location pickers (CLIENTS_PLAN.md §2.3, §2.4;
 * DESIGN.md §5.3): what they offer, grouped, a location with no pin greyed
 * with why, and what they say to someone who can't pick one.
 */

const state = {
    role: "ADMIN",
    grants: new Set(["clients.view", "locations.view", "locations.add"]),
    keys: [] as string[],
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role } } }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p) }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("swr", () => ({
    default: (key: string | [string, string] | null) => {
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (!key) return idle
        const url = Array.isArray(key) ? key[0] : key
        state.keys.push(url)
        if (url.startsWith("/api/clients")) return { ...idle, data: { data: [{ id: "k1", name: "Acme", locations: [{ id: "hq", latitude: 30 }] }] } }
        const body = {
            data: {
                client: url.includes("clientId=k1") ? [{ id: "hq", name: "Nasr City", isHq: true, needsPin: false }, { id: "site", name: "Warehouse", isHq: false, needsPin: true }] : [],
                shared: [{ id: "port", name: "Port gate", isHq: false, needsPin: false }],
            },
        }
        return { ...idle, data: { scope: (key as [string, string])[1], url, body } }
    },
}))

beforeEach(() => {
    state.role = "ADMIN"
    state.grants = new Set(["clients.view", "locations.view", "locations.add"])
    state.keys = []
})

async function picker(value: { clientId: string; locationId: string }, extra: Record<string, unknown> = {}) {
    const { default: TaskPlacePicker } = await import("@/components/locations/TaskPlacePicker")
    return renderToStaticMarkup(h(TaskPlacePicker, { value, onChange: () => {}, ...extra }))
}

describe("a task's location picker", () => {
    it("offers the client's locations, its HQ first and marked, then the shared ones", async () => {
        const html = await picker({ clientId: "k1", locationId: "hq" })
        expect(html).toMatch(/<optgroup label="task_location_client_group">.*Nasr City · locations_hq.*Warehouse.*<\/optgroup><optgroup label="task_location_shared_group">.*Port gate/)
        expect(html).toContain('<option value="hq" selected="">')
    })

    it("lists a location with no pin, greyed, with why", async () => {
        const html = await picker({ clientId: "k1", locationId: "" })
        expect(html).toContain('<option value="site" disabled="">Warehouse · task_location_needs_pin</option>')
    })

    it("offers only the shared ones with no client", async () => {
        const html = await picker({ clientId: "", locationId: "" })
        expect(html).not.toContain("Nasr City")
        expect(html).toContain("Port gate")
        expect(html).toContain("task_no_client")
    })

    it("offers + New location to whoever may add one", async () => {
        expect(await picker({ clientId: "", locationId: "" })).toContain("task_location_new")
        state.grants.delete("locations.add")
        expect(await picker({ clientId: "", locationId: "" })).not.toContain("task_location_new")
    })

    it("tells someone who may not see locations why they can't pick one, without asking for them", async () => {
        state.grants = new Set(["clients.view"])
        const html = await picker({ clientId: "", locationId: "" })
        expect(html).toContain("task_location_no_permission")
        expect(state.keys.some(k => k.startsWith("/api/locations"))).toBe(false)
    })

    it("has a Super Admin pick a company first", async () => {
        state.role = "SUPER_ADMIN"
        const html = await picker({ clientId: "", locationId: "" })
        expect(html).toContain("task_location_pick_company")
        expect(state.keys).toEqual([])
    })

    it("keeps an edited task's location offered when it's no longer listed", async () => {
        const html = await picker({ clientId: "", locationId: "gone" }, { current: { id: "gone", label: "Old depot" } })
        expect(html).toContain('<option value="gone" selected="">Old depot</option>')
    })
})

describe("adding a location from a task's form", () => {
    // Its dialog is portalled out of the task's form, but React still passes
    // a submit up the components to it: saving the location would save the
    // task too, with the location picked before. (No DOM here to submit in.)
    it("keeps its save to itself: the task's form around it isn't submitted too", () => {
        const src = readFileSync("components/locations/LocationForm.tsx", "utf8")
        const save = src.slice(src.indexOf("const save = async"))
        expect(save.slice(0, save.indexOf("if (!ready"))).toContain("e.stopPropagation()")
    })
})
