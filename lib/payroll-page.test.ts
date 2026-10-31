import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Payroll's register on the building blocks, its top first (UI_PLAN.md §5
 * step 5): the page header with its status and the draft's buttons, the
 * month it's for picked under it (DESIGN.md §5.3), the totals as tiles with
 * the file beside them, and paying and sending in one card.
 */

const state = {
    locale: "en" as "en" | "ar",
    role: "ADMIN",
    grants: new Set<string>(),
    keys: [] as (string | null)[],
    result: {} as { data?: unknown; error?: unknown; isLoading?: boolean },
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p) }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        return key ? { ...idle, ...state.result } : idle
    },
}))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))

type View = Record<string, unknown>
const view = (fields: View = {}, register: View = {}): View => ({
    year: 2026, month: 10, payrollDay: 25, status: "DRAFT",
    delivery: null, payslipIds: {},
    register: { entries: [], payableMinor: 1234500, carriedMinor: 0, includedCount: 12, excludedCount: 0, pendingDecisions: [], ...register },
    refused: [], variance: null, sinceDraft: null, draftSavedAt: null, debts: [],
    ...fields,
})
const delivery = (fields: View = {}) => ({ paidAt: null, batchSize: 25, sent: 3, sendable: 12, unsent: 9, ...fields })

async function page({ shows, role = "ADMIN", grants = [], locale = "en" }: { shows?: View | "loading" | "failed"; role?: string; grants?: string[]; locale?: "en" | "ar" } = {}) {
    state.role = role
    state.grants = new Set(grants)
    state.locale = locale
    state.keys = []
    state.result = shows === "loading" ? { isLoading: true }
        : shows === "failed" ? { error: new Error("Request failed") }
            : { data: shows ? { data: shows } : undefined }
    const { default: PayrollRegisterPage } = await import("@/app/(dashboard)/dashboard/payroll/page")
    return renderToStaticMarkup(h(PayrollRegisterPage))
}
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
const period = (html: string) => {
    const at = html.indexOf('class="ui-panel ui-period"')
    if (at < 0) return ""
    const next = ['<section', '<div class="ui-panel'].map(m => html.indexOf(m, at + 1)).filter(i => i > 0)
    return html.slice(at, next.length ? Math.min(...next) : undefined)
}
const totals = (html: string) => {
    const at = html.indexOf(`<h2 class="ui-section-title">${en.payroll_totals}</h2>`)
    return at < 0 ? "" : html.slice(html.lastIndexOf('<section class="ui-section">', at), html.indexOf("</section>", at))
}
// The delivery card, up to the totals after it.
const card = (html: string, title: string) => {
    const at = html.indexOf(`<h2 class="ui-card-title">${title}</h2>`)
    if (at < 0) return ""
    const end = html.indexOf('<section class="ui-section">', at)
    return html.slice(html.lastIndexOf('<section class="ui-panel ui-card">', at), end < 0 ? undefined : end)
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-15T09:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

describe("Payroll's page header", () => {
    it("names the register, with its status, the month it's for and its payday", async () => {
        const top = header(await page({ shows: view() }))
        expect(top).toContain('<h1 class="ui-page-title"><span class="ui-title-with-badge">Payroll register<span class="ui-badge ui-badge-neutral">Draft</span></span></h1>')
        // The payday was "Month 25": the month's label, not the payday's.
        expect(top).toContain('<p class="ui-page-subtitle">October 2026 · Payday: 25</p>')
        expect(header(await page({ shows: view({ status: "APPROVED" }) }))).toContain('<span class="ui-badge ui-badge-good">Approved</span>')
        expect(header(await page({ shows: view({ status: "PAID" }) }))).toContain('<span class="ui-badge ui-badge-good">Paid</span>')
    })

    it("says the month in the page's language, its digits too", async () => {
        const top = header(await page({ shows: view(), locale: "ar" }))
        expect(top).toContain("أكتوبر ٢٠٢٦ · يوم الصرف: ٢٥")
    })

    it("has no status until there's a register to have one", async () => {
        expect(header(await page({ shows: "loading" }))).not.toContain("ui-badge")
    })

    it("holds a draft's Save draft and Approve, for whoever may do each", async () => {
        const both = header(await page({ shows: view(), grants: ["payroll.prepare", "payroll.approve"] }))
        expect(both).toMatch(/<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-secondary">Save draft<\/button><button type="button" class="ui-btn ui-btn-primary">Approve<\/button><\/div>/)
        expect(header(await page({ shows: view(), grants: ["payroll.prepare"] }))).not.toContain(">Approve<")
        expect(header(await page({ shows: view(), grants: ["payroll.approve"] }))).not.toContain("Save draft")
        expect(header(await page({ shows: view() }))).not.toContain("ui-page-actions")
        // Approved, the figures are fixed: nothing to save or approve.
        expect(header(await page({ shows: view({ status: "APPROVED" }), grants: ["payroll.prepare", "payroll.approve"] }))).not.toContain("ui-page-actions")
    })

    it("doesn't offer to approve a month with nobody in it", async () => {
        const top = header(await page({ shows: view({}, { includedCount: 0 }), grants: ["payroll.approve"] }))
        expect(top).toMatch(/<button type="button" class="ui-btn ui-btn-primary" disabled="">Approve<\/button>/)
    })

    it("is the only header: not the old one with its colours typed in", async () => {
        const html = await page({ shows: view(), grants: ["payroll.prepare", "payroll.approve"] })
        expect(html).toContain('<div class="ui-page">')
        expect(html).not.toMatch(/<h1 style=/)
        expect(header(html)).not.toContain("<select")
    })
})

describe("the month Payroll is for", () => {
    it("is picked under the header, the month and the year each with its label", async () => {
        const html = await page({ shows: view() })
        const picker = period(html)
        expect(html.indexOf('class="ui-panel ui-period"')).toBeGreaterThan(html.indexOf("</header>"))
        expect(picker).toMatch(/<label for="[^"]+" class="ui-label">Month<\/label>/)
        expect(picker).toMatch(/<label for="[^"]+" class="ui-label">Year<\/label>/)
        expect(picker.match(/<option /g)?.length).toBe(12 + 5)
        expect(picker).toContain('<option value="10" selected="">October</option>')
        expect(picker).toContain('<option value="2026" selected="">2026</option>')
        expect(picker).not.toContain(">Company<")
    })

    it("names the months and years in the page's language", async () => {
        const picker = period(await page({ shows: view(), locale: "ar" }))
        expect(picker).toContain('<option value="10" selected="">أكتوبر</option>')
        expect(picker).toContain('<option value="2026" selected="">٢٠٢٦</option>')
    })

    it("has the Super Admin pick the company first", async () => {
        const picker = period(await page({ role: "SUPER_ADMIN" }))
        expect(picker).toMatch(/<div class="ui-field ui-period-wide"><label for="[^"]+" class="ui-label">Company<\/label>/)
        expect(picker.indexOf(">Company<")).toBeLessThan(picker.indexOf(">Month<"))
        expect(picker).toContain('<option value="" selected="">Choose a company…</option>')
    })
})

describe("what Payroll shows before its register", () => {
    it("asks the Super Admin to pick a company, and asks the server nothing until then", async () => {
        const html = await page({ role: "SUPER_ADMIN" })
        expect(html).toContain('<p class="ui-empty-title">Pick a company to see its register.</p>')
        expect(state.keys.filter(k => k?.startsWith("/api/payroll"))).toEqual([])
    })

    it("says while the register loads", async () => {
        const html = await page({ shows: "loading" })
        expect(html).toMatch(/<div class="ui-panel" role="status"><div class="ui-empty">.*<p class="ui-empty-title">Loading the register…<\/p>/)
    })

    it("says when it didn't load, with Try again", async () => {
        const html = await page({ shows: "failed" })
        expect(html).toContain('<p class="ui-empty-title">Couldn&#x27;t load the register.</p>')
        expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-secondary">Try again<\/button>/)
        expect(html).not.toContain(en.payroll_totals)
    })
})

describe("Payroll's totals", () => {
    it("are tiles under their heading", async () => {
        const part = totals(await page({ shows: view() }))
        expect(part).toContain('<dl class="ui-tiles">')
        expect(part).toContain("<dt>To be paid</dt><dd>12,345.00</dd>")
        expect(part).toContain("<dt>People</dt><dd>12</dd>")
        // Only when there are any.
        expect(part).not.toContain("Excluded")
        expect(part).not.toContain("Carried as debt")
        const more = totals(await page({ shows: view({}, { excludedCount: 2, carriedMinor: 50000 }) }))
        expect(more).toContain("<dt>Excluded</dt><dd>2</dd>")
        expect(more).toContain("<dt>Carried as debt</dt><dd>500.00</dd>")
    })

    it("count in the page's language", async () => {
        const part = await page({ shows: view(), locale: "ar" })
        expect(part).toContain(`<dt>${ar.payroll_included}</dt><dd>١٢</dd>`)
    })

    it("have the register's file beside their heading, once it's stored", async () => {
        expect(totals(await page({ shows: view() }))).not.toContain("/export")
        const part = totals(await page({ shows: view({ delivery: delivery() }) }))
        expect(part).toContain('<a class="ui-btn ui-btn-quiet ui-btn-sm" href="/api/payroll/2026/10/export" download="">Download CSV</a>')
        // Not in the header, where it made three buttons beside Save draft and Approve.
        expect(header(await page({ shows: view({ delivery: delivery() }), grants: ["payroll.prepare", "payroll.approve"] }))).not.toContain("/export")
    })
})

describe("an approved month", () => {
    it("says its figures are the ones approved, in a card", async () => {
        const html = await page({ shows: view({ status: "APPROVED" }) })
        expect(html).toContain(`<section class="ui-panel ui-card"><p>${en.payroll_approved_locked}</p></section>`)
        expect(await page({ shows: view() })).not.toContain(en.payroll_approved_locked)
    })
})

describe("paying and sending", () => {
    const deliverer = ["payroll.issue_payslips", "payroll.mark_paid"]
    const approved = (d: View = {}) => view({ status: "APPROVED", delivery: delivery(d) })

    it("is one card, each half under its own title", async () => {
        const part = card(await page({ shows: approved(), grants: deliverer }), "Paying and sending")
        expect(part).toContain(`<p class="ui-card-note">${en.payroll_delivery_msg}</p>`)
        expect(part).toContain('<div class="ui-columns">')
        expect(part).toContain('<h3 class="ui-subsection-title">Send payslips</h3>')
        expect(part).toContain('<h3 class="ui-subsection-title">Mark as paid</h3>')
        expect(part).not.toContain("style=")
    })

    it("sends the next batch, and says how far it's got", async () => {
        const part = card(await page({ shows: approved(), grants: deliverer }), "Paying and sending")
        expect(part).toContain("3 of 12 sent")
        expect(part).toMatch(/<button type="button" class="ui-btn ui-btn-primary">Send next 9<\/button>/)
        const sent = card(await page({ shows: approved({ sent: 12, unsent: 0 }), grants: deliverer }), "Paying and sending")
        expect(sent).toContain(en.payroll_issue_all_sent)
        expect(sent).not.toContain("Send next")
        expect(card(await page({ shows: approved({ sendable: 0, sent: 0, unsent: 0 }), grants: deliverer }), "Paying and sending")).toContain(en.payroll_issue_none)
    })

    it("records the payment on a day picked as a field, with its hint", async () => {
        const part = card(await page({ shows: approved(), grants: deliverer }), "Paying and sending")
        expect(part).toMatch(/<label for="[^"]+" class="ui-label">Payment date<\/label>/)
        expect(part).toContain(`class="ui-hint">${en.payroll_paid_date_hint}</span>`)
        expect(part).toMatch(/<button type="button" class="ui-btn ui-btn-secondary">Mark as paid<\/button>/)
        const paid = card(await page({ shows: view({ status: "PAID", delivery: delivery({ paidAt: "2026-10-26T00:00:00.000Z" }) }), grants: deliverer }), "Paying and sending")
        expect(paid).toContain("Paid on 26 Oct 2026")
        expect(paid).not.toContain("Payment date")
    })

    it("offers each half's button only to whoever may do it", async () => {
        const sender = card(await page({ shows: approved(), grants: ["payroll.issue_payslips"] }), "Paying and sending")
        expect(sender).toContain("Send next 9")
        expect(sender).not.toContain("Payment date")
        const payer = card(await page({ shows: approved(), grants: ["payroll.mark_paid"] }), "Paying and sending")
        expect(payer).not.toContain("Send next")
        expect(payer).toContain("Payment date")
        expect(await page({ shows: approved() })).not.toContain("Paying and sending")
        // Not before it's approved.
        expect(await page({ shows: view({ delivery: delivery() }), grants: deliverer })).not.toContain("Paying and sending")
    })
})
