import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import type { TaxPosition } from "./tax-claims"

/**
 * The Tax position section on a client's page, for the company's people
 * (CLIENT_PORTAL_PLAN.md §3.5; DESIGN.md §5.5, A client's tax position, for
 * the company's people; PR 311): what it shows while it loads, when it
 * didn't, before anything was uploaded, and with the client's claims.
 */

// What one request is answered with. `from` is the address its data was read for where that isn't the one asked
// for, as rows kept up from an earlier request are, and `of` the client where it isn't this one.
type Answer = (url: string) => { data?: unknown; from?: string; of?: string } & Record<string, unknown>
const state = { locale: "en", answer: (() => ({})) as Answer, keys: [] as unknown[] }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
// The section's key is [address, client] (lib/swr-scoped.ts): its data comes back saying which address and which
// client it was read for.
vi.mock("swr", () => ({
    default: (key: [string, string]) => {
        state.keys.push(key)
        const [url, scope] = key
        const { data, from, of, ...rest } = state.answer(url)
        return { error: undefined, isLoading: false, isValidating: false, mutate: async () => {}, ...rest, data: data === undefined ? undefined : { scope: of ?? scope, url: from ?? url, body: data } }
    },
}))

let Section: (props: { clientId: string }) => ReactElement
beforeAll(async () => {
    Section = (await import("@/components/tax/TaxPosition")).default
}, 60_000)
beforeEach(() => {
    state.locale = "en"
    state.answer = () => ({})
    state.keys = []
})

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
const render = () => renderToStaticMarkup(h(Section, { clientId: "noor" }))
const claim = (over: Partial<TaxPosition["claims"][number]>): TaxPosition["claims"][number] => ({
    id: "x", claimNumber: "000100", item: "إقرار ضريبة الدخل", taxType: "دخل", registrationType: null,
    originalAmount: 100, paidAmount: 0, remainingAmount: 100, currency: "جنيه مصري", status: "في انتظار السداد",
    periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-12-31", daysLate: 0, ...over,
})
const NOOR: TaxPosition = {
    client: { id: "noor", name: "Al Noor", archived: false },
    today: "2026-11-17",
    position: { asOf: "2026-10-14", uploadedOn: "2026-10-15", uploadedBy: "Amal One" },
    totals: { original: 1955.5, paid: 210.25, remaining: 1745.25, open: 7, late: 2 },
    claims: [
        claim({ id: "n1", claimNumber: "000101", originalAmount: 1000, remainingAmount: 1000, periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30", daysLate: 201 }),
        claim({ id: "n2", claimNumber: "000102", item: "إقرار القيمة المضافة", originalAmount: 500.5, paidAmount: 200.25, remainingAmount: 300.25, periodStart: "2026-08-01", periodEnd: "2026-08-31", dueDate: "2026-09-30", daysLate: 48 }),
        claim({ id: "n4", claimNumber: "000104", item: "مساهمة تكافلية", originalAmount: 50, paidAmount: 10, remainingAmount: 40, periodStart: null, periodEnd: null, dueDate: "2026-12-31", daysLate: 0 }),
    ],
    total: 7,
    totalPages: 2,
    accountant: { person: null, reach: "none" },
}
const shown = (data: TaxPosition) => { state.answer = () => ({ data: { data } }) }

describe("the Tax position section", () => {
    it("asks for the client's first five claims, as that client's", () => {
        render()
        expect(state.keys).toEqual([["/api/tax-claims?clientId=noor&limit=5&page=1", "noor"]])
    })

    it("says it's loading under its title, to screen readers too", () => {
        state.answer = () => ({ isLoading: true })
        const html = render()
        expect(html).toContain(`<h2 class="ui-section-title">${en.tax_position}</h2>`)
        expect(html).toMatch(new RegExp(`<div class="ui-panel" role="status">.*${en.tax_position_loading}`))
        expect(html).not.toContain(en.tax_owed)
    })

    it("says it didn't load, with Try again", () => {
        state.answer = () => ({ error: new Error("no") })
        const html = render()
        expect(html).toContain(esc(en.tax_position_failed))
        expect(html).toMatch(new RegExp(`<button[^>]*>${en.try_again}</button>`))
        expect(html).not.toContain(en.tax_position_loading)
    })

    it("says it didn't load where the page asked for didn't, the claims kept up from another page not standing in for it", () => {
        // As when Show all claims, or another page, fails with the first five still kept up (keepPreviousData).
        state.answer = () => ({ data: { data: NOOR }, from: "/api/tax-claims?clientId=noor&limit=20&page=2", error: new Error("no") })
        const html = render()
        expect(html).toContain(esc(en.tax_position_failed))
        expect(html).toMatch(new RegExp(`<button[^>]*>${en.try_again}</button>`))
        expect(html).not.toContain("000101")
        expect(html).not.toContain(esc(en.tax_owed))
        expect(html).not.toContain(en.tax_show_fewer)
        expect(html).not.toContain(en.tax_no_open_claims)
    })

    it("keeps its claims up where only reading the same page again failed", () => {
        state.answer = () => ({ data: { data: NOOR }, error: new Error("no") })
        const html = render()
        expect(html).toContain("000101")
        expect(html).toContain(esc(en.tax_owed))
        expect(html).not.toContain(esc(en.tax_position_failed))
    })

    it("shows nothing read for another client, as if nothing had loaded yet", () => {
        state.answer = () => ({ data: { data: NOOR }, of: "another" })
        const html = render()
        expect(html).toContain(en.tax_position_loading)
        expect(html).not.toContain("000101")
        expect(html).not.toContain(esc(en.tax_owed))
    })

    it("says there's no tax position yet before anything is uploaded, with no totals and no list", () => {
        shown({ ...NOOR, position: null, totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0 })
        const html = render()
        expect(html).toContain(en.tax_position_none)
        expect(html).toContain(esc(en.tax_position_none_detail))
        expect(html).not.toContain(esc(en.tax_owed))
        expect(html).not.toContain("<table")
        expect(html).not.toContain(en.tax_no_open_claims)
    })

    it("says the day the figures are from, and who uploaded the file and when", () => {
        // Read 20 days on: from 30 days the line also says how long it's been (§4.3, PR 321; lib/tax-figures-old.test.ts).
        shown({ ...NOOR, today: "2026-11-03" })
        expect(render()).toContain(`<p class="ui-hint">Figures as of 14 Oct 2026, from the portal&#x27;s file uploaded by <bdi>Amal One</bdi> on 15 Oct 2026.</p>`)
        // Without a name, as when a file was uploaded by someone whose name wasn't kept.
        shown({ ...NOOR, today: "2026-11-03", position: { asOf: "2026-10-14", uploadedOn: "2026-10-15", uploadedBy: null } })
        expect(render()).toContain(`<p class="ui-hint">Figures as of 14 Oct 2026, from the portal&#x27;s file uploaded on 15 Oct 2026.</p>`)
        // And 34 days on, as Al Noor's are: its words, then how long.
        shown(NOOR)
        expect(render()).toContain(`uploaded by <bdi>Amal One</bdi> on 15 Oct 2026. <span class="ui-badge ui-badge-waiting">Not updated for 34 days</span></p>`)
    })

    it("totals what's owed, the open claims, the late ones and what's paid", () => {
        shown(NOOR)
        const html = render()
        for (const [label, value] of [[en.tax_owed, "1,745.25 EGP"], [en.tax_open_claims, "7"], [en.tax_late_claims, "2"], [en.tax_paid, "210.25 EGP"]]) {
            expect(html, label).toContain(`<dt>${esc(label)}</dt><dd>${value}</dd>`)
        }
    })

    it("lists each claim: its number as typed into the portal, its item, period, amounts and last day to pay", () => {
        shown(NOOR)
        const html = render()
        for (const header of [en.tax_col_number, en.tax_col_item, en.tax_col_period, en.tax_col_original, en.tax_paid, en.tax_col_remaining, en.tax_col_due, en.tax_col_status]) {
            expect(html, header).toMatch(new RegExp(`<th[^>]*>${header}</th>`))
        }
        expect(html).toContain(`<bdi dir="ltr" class="ui-num">000101</bdi>`)
        expect(html).toContain("<bdi>إقرار ضريبة الدخل</bdi>")
        // Each of a period's days stays on one line.
        expect(html).toContain("1\u00a0Jan\u00a02025 to 31\u00a0Dec\u00a02025")
        expect(html).toContain(`<span class="ui-nowrap">500.50 EGP</span>`)
        expect(html).toContain(`<span class="ui-nowrap">200.25 EGP</span>`)
        // What remains stands out.
        expect(html).toContain(`<strong class="ui-nowrap">300.25 EGP</strong>`)
        expect(html).toContain("30 Apr 2026")
        // How late, under its last day to pay; nothing under one that isn't.
        expect(html).toContain(`<div class="ui-hint">201 days late</div>`)
        expect(html).toContain(`<div class="ui-hint">48 days late</div>`)
        expect(html.match(/<div class="ui-hint">/g)).toHaveLength(2)
    })

    it("badges a claim Partly paid and Late, both where it's both", () => {
        shown(NOOR)
        const html = render()
        const late = `<span class="ui-badge ui-badge-problem">${en.tax_badge_late}</span>`
        const partly = `<span class="ui-badge ui-badge-waiting">${en.tax_badge_partly_paid}</span>`
        // Partly paid first, as the owner's mockup draws them (PR 339).
        expect(html).toContain(`${partly} ${late}`)
        // In the table and on the phone's cards: n1 and n2 late, n2 and n4 partly paid.
        expect(html.split(late).length - 1).toBe(4)
        expect(html.split(partly).length - 1).toBe(4)
    })

    it("offers Show all claims with how many when there are more than five, and not otherwise", () => {
        shown(NOOR)
        expect(render()).toMatch(new RegExp(`<button[^>]*aria-expanded="false"[^>]*>${esc("Show all claims (7)").replace(/[()]/g, "\\$&")}</button>`))
        shown({ ...NOOR, total: 3, totalPages: 1, totals: { ...NOOR.totals, open: 3 } })
        const few = render()
        expect(few).not.toContain("Show all claims")
        expect(few).not.toContain("aria-expanded")
    })

    it("goes to the last page there is, on a page past it as the claims became fewer", () => {
        const source = readFileSync("components/tax/TaxPosition.tsx", "utf8")
        expect(source).toContain("const pageCount = all ? Math.ceil((body?.total ?? 0) / TAX_PAGE) : 1")
        expect(source).toContain("useAdjustOnChange([pageCount], () => setPage(p => pageInRange(p, pageCount)))")
        expect(source).toContain("page={pageInRange(page, pageCount)}")
        // And the page it goes to is asked for again, not taken as it was kept: it may be the earlier file's.
        expect(source).toContain("dedupingInterval: 0")
    })

    it("keeps the day and the totals, at 0, where the file had no open claim", () => {
        shown({ ...NOOR, totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0 })
        const html = render()
        expect(html).toContain("Figures as of 14 Oct 2026")
        expect(html).toContain(`<dt>${esc(en.tax_owed)}</dt><dd>0.00 EGP</dd>`)
        expect(html).toContain(`<dt>${en.tax_open_claims}</dt><dd>0</dd>`)
        expect(html).toContain(en.tax_no_open_claims)
        expect(html).toContain("Nothing was owed on the portal on 14 Oct 2026.")
        expect(html).not.toContain(en.tax_position_none)
    })

    // The responsible accountant (CLIENT_PORTAL_PLAN.md §7, PR 343): what the panel shows is lib/client-accountant.test.ts's.
    it("has the responsible accountant at its foot, after the claims, and before the first file too", () => {
        shown(NOOR)
        const html = render()
        expect(html).toContain('<div class="ui-panel ui-accountant">')
        expect(html.indexOf("ui-accountant")).toBeGreaterThan(html.indexOf("000104"))
        expect(html).toMatch(/<\/div><\/div><\/section>$/)
        shown({ ...NOOR, position: null, totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0 })
        const none = render()
        expect(none).toContain('<div class="ui-panel ui-accountant">')
        expect(none.indexOf("ui-accountant")).toBeGreaterThan(none.indexOf(esc(en.tax_position_none)))
    })

    it("is in Arabic with the page's digits, a claim's number staying as it's typed into the portal", () => {
        state.locale = "ar"
        shown(NOOR)
        const html = render()
        expect(html).toContain(`<h2 class="ui-section-title">${ar.tax_position}</h2>`)
        expect(html).toContain(`<dt>${ar.tax_owed}</dt><dd>١٬٧٤٥٫٢٥ ${ar.egp}</dd>`)
        expect(html).toContain(`<dt>${ar.tax_open_claims}</dt><dd>٧</dd>`)
        expect(html).toContain(`<bdi dir="ltr" class="ui-num">000101</bdi>`)
        expect(html).toContain("<bdi>Amal One</bdi>")
        expect(html).toContain("عرض كل المطالبات (٧)")
        expect(html).toContain(ar.tax_badge_partly_paid)
    })
})

describe("on the client's page", () => {
    const page = readFileSync("app/(dashboard)/dashboard/clients/[id]/page.tsx", "utf8")

    it("is there for whoever may see it, where the company's package has the client portal", () => {
        expect(page).toContain("const seesTax = features.has('TAX_POSITION') && can('tax.view')")
        expect(page).toContain("{seesTax && <TaxPosition key={id} clientId={id} manages={can('tax.manage')} picks={can('clients.manage')} editsProfile={person => editsProfile({ can, viewer, person })} />}")
    })

    it("is made again for another client, so one client's figures never stand in for the next's", () => {
        // The section keeps what it showed while a new page of claims loads (keepPreviousData).
        expect(readFileSync("components/tax/TaxPosition.tsx", "utf8")).toContain("keepPreviousData: true, dedupingInterval: 0")
        expect(page).toContain("<TaxPosition key={id} ")
    })

    it("comes after the client's details and before its locations", () => {
        const at = (text: string) => { const i = page.indexOf(text); expect(i, text).toBeGreaterThan(-1); return i }
        expect(at("{seesTax && <TaxPosition")).toBeGreaterThan(at("{detailsFailed && ("))
        expect(at("{seesTax && <TaxPosition")).toBeLessThan(at("{seesLocations && ("))
    })
})
