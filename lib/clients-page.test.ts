import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The Clients list on the building blocks (CLIENTS_PLAN.md §8, DESIGN.md §5):
 * who sees it, what it says when it can't show the list, and its buttons'
 * words, which follow a company's own name for its clients.
 */

const state = {
    /** Whether the session has loaded: until it has, useSession has no user. */
    loaded: true,
    role: "ADMIN",
    grants: new Set(["clients.view", "clients.manage"]),
    label: undefined as string | undefined,
    keys: [] as (string | null)[],
    list: { data: { data: [] as unknown[] } } as { data?: unknown; error?: Error },
}
vi.mock("next-auth/react", () => ({ useSession: () => (state.loaded ? { data: { user: { id: "u1", role: state.role } }, status: "authenticated" } : { data: undefined, status: "loading" }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p) }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => (key === "clients" ? "Clients" : key) }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => state.label ?? "Clients", icon: () => "🚚" }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        return key ? { ...state.list, isLoading: false, isValidating: false, mutate: async () => {} } : { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
    },
}))

beforeEach(() => {
    state.loaded = true
    state.role = "ADMIN"
    state.grants = new Set(["clients.view", "clients.manage"])
    state.label = undefined
    state.keys = []
    state.list = { data: { data: [] } }
})

async function page() {
    const { default: ClientsPage } = await import("@/app/(dashboard)/dashboard/clients/page")
    return renderToStaticMarkup(h(ClientsPage))
}

describe("the Clients list", () => {
    it("tells someone who may not see clients so, without asking for them", async () => {
        state.role = "EMPLOYEE"
        state.grants = new Set()
        const html = await page()
        expect(html).toContain("Access Restricted")
        expect(html).not.toContain("clients_load_failed")
        expect(state.keys.filter(Boolean)).toEqual([])
    })

    it("waits for the session, rather than saying there are none before it knows who's looking", async () => {
        // Before it loads, nobody holds anything, so nothing is asked for.
        state.loaded = false
        state.grants = new Set()
        const html = await page()
        expect(html).toContain("clients_loading")
        expect(html).not.toContain("clients_none")
        expect(html).not.toContain("Access Restricted")
    })

    it("says the list didn't load, with Try again, rather than that there are none", async () => {
        state.list = { error: new Error("Request failed") }
        const html = await page()
        expect(html).toContain("clients_load_failed")
        expect(html).toContain("try_again")
        expect(html).not.toContain("clients_none")
    })

    it("offers to add the first client to whoever may", async () => {
        const html = await page()
        expect(html).toContain("clients_none")
        expect(html).toContain("clients_add")
        state.grants = new Set(["clients.view"])
        expect(await page()).not.toContain("clients_add")
    })

    it("says Add client, and a company's own name for its clients when it has one", async () => {
        expect(await page()).not.toContain("Add Clients")
        state.label = "Patients"
        const html = await page()
        expect(html).toContain("Add Patients")
        expect(html).not.toContain("clients_add")
    })
})
