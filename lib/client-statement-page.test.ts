import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "./translations/en"
import { SWRError } from "./swr-fetcher"
import type { Statement } from "./client-statement"

/**
 * A client's statement page (CLIENTS_PLAN.md §6.9; DESIGN.md §5.5, Client
 * statement): the statement it shows, and prints, is the one fetched for its
 * address. SWR keeps the last statement while another loads; Codex found, on
 * PR 227, that with the period cleared the one for the dates before was taken
 * for last month's, printable, and kept in place of last month's refusal
 * where that had more than 200 charges.
 *
 * The sheet itself is tested in lib/client-statement.test.ts.
 */

type Fetch = (key: string) => Promise<unknown>
type Answer = (key: string) => Record<string, unknown>
const state = {
    search: "",
    // What SWR gives back for the address the page asks for, set by each test.
    answer: (() => ({})) as Answer,
    keys: [] as string[],
    fetchers: [] as Fetch[],
}
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => (en as Record<string, string>)[key] ?? key }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Clients" }) }))
vi.mock("@/components/DateRangePicker", () => ({ default: () => null }))
vi.mock("next/navigation", () => ({
    useParams: () => ({ id: "noor" }),
    useSearchParams: () => new URLSearchParams(state.search),
    useRouter: () => ({ replace: () => {} }),
    usePathname: () => "/dashboard/clients/noor/statement",
}))
vi.mock("swr", () => ({
    default: (key: string, fetcher: Fetch) => {
        state.keys.push(key)
        state.fetchers.push(fetcher)
        return { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {}, ...state.answer(key) }
    },
}))

let Page: () => ReactElement
beforeAll(async () => {
    Page = (await import("@/app/(dashboard)/dashboard/clients/[id]/statement/page")).default
}, 60_000)
beforeEach(() => {
    state.search = ""
    state.answer = () => ({})
    state.keys = []
    state.fetchers = []
})

const render = () => renderToStaticMarkup(h(Page))
// The statement for 29 October alone.
const OCT_29: Statement = {
    company: { name: "Nile Works", logoUrl: null },
    client: { id: "noor", name: "Al Noor Trading", ownerName: "Hassan Adel" },
    period: { from: "2026-10-29", to: "2026-10-29" },
    issuedOn: "2026-11-08",
    charges: [],
    totals: { paid: 0, fees: 0, charged: 0, collected: 0, due: 0, dueCount: 0, dueBefore: 0, dueBeforeCount: 0, stillDue: 0 },
}
const TOO_MANY = Object.assign(new SWRError("Request failed"), {
    status: 400,
    info: { success: false, error: "This period has more than 200 charges", code: "STATEMENT_TOO_MANY" },
})
// What the page's own fetcher makes of the server's answer for an address,
// as SWR then holds it.
async function fetched(key: string, statement: Statement): Promise<unknown> {
    const fetcher = state.fetchers.at(-1)!
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, data: statement }), { status: 200, headers: { "content-type": "application/json" } }))
    try {
        return await fetcher(key)
    } finally {
        vi.unstubAllGlobals()
    }
}
// The statement for 29 October, as the page first had it.
async function opened29October() {
    state.search = "from=2026-10-29&to=2026-10-29"
    render()
    const key = state.keys.at(-1)!
    expect(key).toBe("/api/charges/statement?clientId=noor&from=2026-10-29&to=2026-10-29")
    const kept = await fetched(key, OCT_29)
    state.answer = asked => (asked === key ? { data: kept } : {})
    const html = render()
    expect(html).toContain('<p class="ui-doc-company">Nile Works</p>')
    expect(html).toContain("<dd>29 October 2026</dd>")
    expect(html).toContain('class="ui-page-actions"')
    return kept
}

describe("the statement it shows", () => {
    it("is the one fetched for its address", async () => {
        await opened29October()
    })

    it("isn't the period before's while last month's loads, with the period cleared", async () => {
        const kept = await opened29October()
        // Cleared: SWR keeps 29 October's while last month's loads.
        state.search = ""
        state.answer = () => ({ data: kept, isLoading: true, isValidating: true })
        const html = render()
        expect(state.keys.at(-1)).toBe("/api/charges/statement?clientId=noor")
        expect(html).not.toContain("ui-doc-company")
        expect(html).not.toContain('class="ui-page-actions"')
        expect(html).toContain('role="status"')
    })

    it("says last month has too many charges, rather than keep the period before's", async () => {
        const kept = await opened29October()
        // Last month refused: SWR still holds 29 October's, with the refusal.
        state.search = ""
        state.answer = () => ({ data: kept, error: TOO_MANY })
        const html = render()
        expect(html).not.toContain("ui-doc-company")
        expect(html).not.toContain('class="ui-page-actions"')
        expect(html).toContain(en.statement_too_many.replace("{max}", "200"))
    })

    it("names the client meanwhile, from the statement it had", async () => {
        const kept = await opened29October()
        state.search = ""
        state.answer = () => ({ data: kept, isLoading: true, isValidating: true })
        expect(render()).toContain('<p class="ui-page-subtitle"><bdi>Al Noor Trading</bdi></p>')
    })
})
