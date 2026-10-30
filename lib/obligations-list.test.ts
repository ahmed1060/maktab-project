import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "./translations/en"

/**
 * The Obligations list on the building blocks (UI_PLAN.md §5 step 5), as
 * the Tasks list is (lib/tasks-list.test.ts): its page header, a filter bar,
 * and the obligations as a table on computers and cards on phones
 * (DESIGN.md §5.4), each with how often it recurs, who it's for, its
 * deadline, its points, its status and what to do next.
 */

const address = { query: "" }
const viewer = { sees: true, manages: true }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(address.query),
}))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/HeaderContext", () => ({ useHeader: () => ({ setTitle: () => {}, setSubtitle: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Obligations" }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: (p: string) => p === "obligations.view" ? viewer.sees : p === "obligations.manage" ? viewer.manages : false }),
}))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("@/components/DateRangePicker", () => ({ default: () => null }))

const NOW = Date.parse("2026-10-30T12:00:00Z")
const me = { id: "me", firstName: "Tarek", lastName: "Ali" }
const mona = { id: "u2", firstName: "Mona", lastName: "Adel" }
const obligation = (fields: object = {}) => ({
    id: "o1", title: "Renew the trade licence", status: "PENDING", difficulty: 2, recurrence: "YEARLY",
    deadline: "2026-11-15T09:00:00Z", createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z",
    lastStatusUpdateBy: null, assignees: [mona],
    ...fields,
})

async function obligationsList(rows: ReturnType<typeof obligation>[], { query = "", sees = true, manages = true } = {}) {
    address.query = query
    viewer.sees = sees
    viewer.manages = manages
    const { default: ObligationsClient } = await import("@/app/(dashboard)/dashboard/obligations/ObligationsClient")
    return renderToStaticMarkup(h(ObligationsClient, { obligations: rows, total: rows.length, page: 1, totalPages: 1, currentUserId: me.id, now: NOW }))
}
const cards = (html: string) => html.slice(html.indexOf('<ul class="ui-cards"'))

describe("the Obligations list", () => {
    it("has the page header, with Add obligation as its one primary button for whoever manages them", async () => {
        const html = await obligationsList([obligation()])
        const header = html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
        expect(header).toContain("obligations_subtitle")
        expect(header).toContain('href="/dashboard/obligations/new"')
        expect(header).toContain("add_obligation")
        expect(html.match(/ui-btn-primary/g)?.length).toBe(1)
        expect(await obligationsList([obligation()], { manages: false })).not.toContain("add_obligation")
    })

    it("lists each obligation as a table row and a phone card, its title linking to it, with how often it recurs", async () => {
        const html = await obligationsList([obligation()])
        expect(html).toContain('<table class="ui-table">')
        expect(html).toContain('class="ui-list-card"')
        expect(html).toContain('href="/dashboard/obligations/o1"')
        expect(html).toContain("recurrence_yearly")
        expect(html).toContain("Mona Adel")
        expect(html).toContain("count_pts_other")
        expect(html).toContain("status_pending")
        expect(html).not.toContain("title-button")
    })

    it("marks one past its deadline and not yet decided as overdue, in words", async () => {
        const late = await obligationsList([obligation({ deadline: "2026-10-29T09:00:00Z", status: "PENDING_CONFIRMATION" })])
        expect(late).toContain('data-tone="overdue"')
        expect(late).toContain("ui_overdue")
        expect(await obligationsList([obligation({ deadline: "2026-10-29T09:00:00Z", status: "APPROVED" })])).not.toContain('data-tone="overdue"')
    })

    it("offers starting one to whoever it's for, and viewing it to anyone else, on the phone's card too", async () => {
        const start = await obligationsList([obligation({ assignees: [me] })], { sees: false })
        expect(start).toContain("start_obligation")
        expect(cards(start)).toContain("start_obligation")
        expect(cards(await obligationsList([obligation({ assignees: [me], status: "IN_PROGRESS" })], { sees: false }))).toContain("continue_obligation")
        expect(cards(await obligationsList([obligation()]))).toContain("view_obligation")
    })

    it("says who decided one", async () => {
        expect(await obligationsList([obligation({ status: "APPROVED", lastStatusUpdateBy: "Hana Said" })])).toContain("list_status_by")
    })

    it("gives someone who sees only their own the search alone, and everyone else the filters", async () => {
        const own = await obligationsList([obligation({ assignees: [me] })], { sees: false })
        expect(own).toContain('class="ui-panel ui-filterbar"')
        expect(own).not.toContain("ui-filterbar-toggle")
        const all = await obligationsList([obligation()])
        expect(all).toContain("ui-filterbar-toggle")
        expect(all).toContain("all_employees")
        expect(all).toContain("all_statuses")
        expect(all).toContain("list_sort_smart")
    })

    it("offers Reset when filters empty it", async () => {
        const filtered = await obligationsList([], { query: "status=REJECTED" })
        expect(filtered).toContain("obligations_empty_filters")
        expect(filtered).toContain("ui_reset_filters")
        expect(await obligationsList([])).toContain("obligations_empty")
    })
})

describe("how often an obligation recurs", () => {
    it("is in sentence case, as the list's other words are (DESIGN.md §3.4)", () => {
        for (const key of ["recurrence_one_time", "recurrence_daily", "recurrence_weekly", "recurrence_monthly", "recurrence_yearly"] as const) {
            const word = en[key]
            expect(word.slice(1), key).toBe(word.slice(1).toLowerCase())
        }
    })
})
