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
    /** Each row menu's items, in the order they're drawn: the table's rows, then the phone's cards. */
    menus: [] as { key: string; label: string; danger?: boolean }[][],
}
vi.mock("next-auth/react", () => ({ useSession: () => (state.loaded ? { data: { user: { id: "u1", role: state.role } }, status: "authenticated" } : { data: undefined, status: "loading" }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p) }), useViewer: () => ({ id: "u1", role: "EMPLOYEE" }) }))
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

// What each row's menu offers is in its items, which are drawn only once it's opened.
vi.mock("@/components/ui", async (importOriginal) => {
    const ui = await importOriginal<typeof import("@/components/ui")>()
    const RowMenu = (props: Parameters<typeof ui.RowMenu>[0]) => {
        state.menus.push(props.items as never)
        return h(ui.RowMenu, props)
    }
    return { ...ui, RowMenu }
})

beforeEach(() => {
    state.menus = []
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
        expect(html).toContain("access_denied_title")
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
        expect(html).not.toContain("access_denied_title")
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

/**
 * Delete, Archive and Delete permanently in a client's menu (CLIENTS_PLAN.md
 * §4.3; CLIENT_PORTAL_PLAN.md §3.6, PR 313).
 */
describe("a client's menu on the Clients list", () => {
    const client = (over: Record<string, unknown>) => ({ id: "x", name: "X", ownerName: "Omar", mobileNumber: "0100", locationName: "Cairo", locationLink: null, locations: [], createdBy: null, archivedAt: null, inUse: false, hasTax: false, ...over })
    const keys = (items: { key: string }[]) => items.map(i => i.key)

    it("offers Delete for a client nothing holds, and Archive for one with tasks, records or a tax position", async () => {
        state.list = { data: { data: [
            client({ id: "a", name: "Alpha" }),
            client({ id: "b", name: "Beta", inUse: true }),
            client({ id: "c", name: "Gamma", hasTax: true }),
        ] } }
        await page()
        // Three rows, then their three cards.
        expect(state.menus.slice(0, 3).map(keys)).toEqual([["tasks", "edit", "delete"], ["tasks", "edit", "archive"], ["tasks", "edit", "archive"]])
        expect(state.menus.slice(3).map(keys)).toEqual(state.menus.slice(0, 3).map(keys))
        expect(state.menus[0][2]).toMatchObject({ label: "delete", danger: true })
        // Archiving can be undone, so it isn't in the danger colour.
        expect(state.menus[2][2]).toMatchObject({ label: "clients_archive" })
        expect(state.menus[2][2].danger).toBeFalsy()
    })

    it("offers Delete permanently, last and in the danger colour, for an archived client that no task or record holds", async () => {
        state.list = { data: { data: [
            client({ id: "d", name: "Delta", archivedAt: "2026-10-01T10:00:00Z", inUse: true, hasTax: true }),
            client({ id: "e", name: "Echo", archivedAt: "2026-10-01T10:00:00Z", hasTax: true }),
            client({ id: "f", name: "Fox", archivedAt: "2026-10-01T10:00:00Z" }),
        ] } }
        await page()
        expect(state.menus.slice(0, 3).map(keys)).toEqual([["tasks", "restore"], ["tasks", "restore", "delete-for-good"], ["tasks", "restore", "delete-for-good"]])
        expect(state.menus[1][2]).toMatchObject({ label: "clients_delete_for_good", danger: true })
    })

    it("offers neither to someone who may see clients and not manage them", async () => {
        state.grants = new Set(["clients.view"])
        state.list = { data: { data: [client({ id: "c", name: "Gamma", hasTax: true }), client({ id: "e", name: "Echo", archivedAt: "2026-10-01T10:00:00Z", hasTax: true })] } }
        await page()
        expect(state.menus.slice(0, 2).map(keys)).toEqual([["tasks"], ["tasks"]])
    })
})
