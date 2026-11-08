import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { moduleForApiPath } from "./features/routes"
import { KNOWN_REFUSALS } from "./api-errors"
import {
    STATEMENT_MAX_CHARGES, isPdfReceipt, lastMonth, numberReceipts, statementHref, statementNote, statementPeriod, statementTotals,
    type Statement, type StatementCharge,
} from "./client-statement"

/**
 * A client statement (DESIGN.md §5.5, Client statement and a document's
 * table; CLIENTS_PLAN.md §6.9): what one client was charged in a period, with
 * the receipts, to print or save as a PDF. The charges added in the period
 * and not left off the bill, each Due or Collected as it is the day it's
 * issued; what's still due from before as one line; and Still due, all of it,
 * as the figure the statement is for. A client's charges were on screen only.
 *
 * Which charges it picks, in the company's own days, is proven against
 * Postgres in lib/client-statement.db.test.ts; here, what CI can run.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/storage", () => ({ supabase: {}, uploadToCloud: async () => { throw new Error("no uploads here") } }))
beforeEach(() => { state.locale = "en" })
// Loaded once, first: compiled cold, a component takes longer than a test may.
beforeAll(async () => { await import("@/components/charges/ClientStatement") }, 60_000)

const read = (path: string) => readFileSync(path, "utf8")
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
// A sentence as the sheet writes it: its own words escaped, its blanks filled with markup.
const sentence = (template: string, values: Record<string, string>) =>
    template.split(/(\{\w+\})/).map(part => { const key = /^\{(\w+)\}$/.exec(part)?.[1]; return key !== undefined && key in values ? values[key] : esc(part) }).join("")

const RECEIPTS = "https://p.supabase.co/storage/v1/object/public/app-assets/c1/receipts"
const charge = (over: Partial<StatementCharge>): StatementCharge => ({
    id: "x", day: "2026-10-02", description: "Spare parts", task: { id: "k1", title: "AC repair, 2nd floor" },
    paid: 0, fee: 0, total: 0, collectedOn: null, receipt: null, ...over,
})
// The mock-up's October for Al Noor Trading (https://claude.ai/artifact/FesR8AbYHBrEYM5ZtfKGq9).
const CHARGES = numberReceipts([
    { ...charge({ id: "x1", day: "2026-10-02", paid: 1850, fee: 150, total: 2000, collectedOn: "2026-10-20" }), receiptUrl: `${RECEIPTS}/r1.jpg` },
    { ...charge({ id: "x2", day: "2026-10-05", description: "Cable ties and tape", task: { id: "k2", title: "Network cabling" }, paid: 240, fee: 20, total: 260, collectedOn: "2026-10-20" }), receiptUrl: `${RECEIPTS}/r2.png` },
    { ...charge({ id: "x3", day: "2026-10-09", description: "Taxi", task: { id: "k2", title: "Network cabling" }, paid: 120, fee: 0, total: 120, collectedOn: "2026-10-20" }), receiptUrl: null },
    { ...charge({ id: "x4", day: "2026-10-14", description: "Paint", task: { id: "k3", title: "Repaint the reception" }, paid: 1300, fee: 100, total: 1400 }), receiptUrl: `${RECEIPTS}/r4.pdf` },
    { ...charge({ id: "x5", day: "2026-10-21", description: "Door handle", task: { id: "k4", title: "Fix the meeting room door" }, paid: 350, fee: 50, total: 400 }), receiptUrl: `${RECEIPTS}/r5.webp` },
    { ...charge({ id: "x6", day: "2026-10-28", description: "LED bulbs", task: { id: "k5", title: "Replace the lights, Maadi branch" }, paid: 540, fee: 60, total: 600 }), receiptUrl: `${RECEIPTS}/r6.jpg` },
])
const STATEMENT: Statement = {
    company: { name: "Nile Works", logoUrl: null },
    client: { id: "noor", name: "Al Noor Trading", ownerName: "Hassan Adel" },
    period: { from: "2026-10-01", to: "2026-10-31" },
    issuedOn: "2026-11-08",
    charges: CHARGES,
    totals: statementTotals(CHARGES, { amount: 600, count: 1 }),
}

async function sheet(over: Partial<Statement> = {}, withReceipts = true) {
    const { StatementSheet } = await import("@/components/charges/ClientStatement")
    return renderToStaticMarkup(h(StatementSheet, { statement: { ...STATEMENT, ...over }, withReceipts }))
}
const line = (label: string, amount: string) => `<div class="ui-doc-line"><span>${esc(label)}</span><bdi class="ui-doc-amount">${amount}</bdi></div>`
const total = (label: string, amount: string) => `<div class="ui-doc-line ui-doc-total"><span>${esc(label)}</span><bdi class="ui-doc-amount">${amount}</bdi></div>`

describe("the period", () => {
    it("is last month where the company is, as it opens", () => {
        expect(lastMonth("2026-11-08")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
        expect(lastMonth("2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" })
        expect(lastMonth("2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
        expect(lastMonth("2028-03-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" })
    })

    it("is the days asked for, in order, or last month without both", () => {
        expect(statementPeriod("2026-10-01", "2026-10-31", "2026-11-08")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
        expect(statementPeriod("2026-10-31", "2026-10-01", "2026-11-08")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
        expect(statementPeriod("2026-10-05", "2026-10-05", "2026-11-08")).toEqual({ from: "2026-10-05", to: "2026-10-05" })
        // One end, a day that isn't one, or a time: the client's Charges picks both or neither.
        for (const [from, to] of [["2026-10-01", ""], ["", "2026-10-31"], ["2026-02-30", "2026-03-04"], ["2026-10-01T00:00:00Z", "2026-10-31"], [undefined, undefined], [7, ["x"]]]) {
            expect(statementPeriod(from, to, "2026-11-08")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
        }
    })

    it("is the client's Charges' dates when it opens from there, both or none", () => {
        expect(statementHref("noor", "2026-10-01", "2026-10-31")).toBe("/dashboard/clients/noor/statement?from=2026-10-01&to=2026-10-31")
        expect(statementHref("noor", "", "")).toBe("/dashboard/clients/noor/statement")
        expect(statementHref("noor", "2026-10-01", "")).toBe("/dashboard/clients/noor/statement")
        expect(statementHref("a/b c", "", "")).toBe("/dashboard/clients/a%2Fb%20c/statement")
    })
})

describe("its charges, receipts and totals", () => {
    it("numbers the receipts in the statement's order, among the charges with one", () => {
        expect(CHARGES.map(c => c.receipt?.number ?? null)).toEqual([1, 2, null, 3, 4, 5])
        expect(CHARGES.map(c => c.receipt?.pdf ?? null)).toEqual([false, false, null, true, false, false])
        expect(CHARGES[0].receipt?.url).toBe(`${RECEIPTS}/r1.jpg`)
        expect(CHARGES[0]).not.toHaveProperty("receiptUrl")
    })

    it("knows a PDF by its file's name, whatever its case", () => {
        expect(isPdfReceipt(`${RECEIPTS}/a.pdf`)).toBe(true)
        expect(isPdfReceipt(`${RECEIPTS}/a.PDF`)).toBe(true)
        expect(isPdfReceipt(`${RECEIPTS}/a.pdf.jpg`)).toBe(false)
        expect(isPdfReceipt(`${RECEIPTS}/pdf`)).toBe(false)
        expect(isPdfReceipt("not a link")).toBe(false)
    })

    it("adds up what was charged, what of it was collected, and all that's still due", () => {
        expect(STATEMENT.totals).toEqual({
            paid: 4400, fees: 380, charged: 4780, collected: 2380,
            due: 2400, dueCount: 3, dueBefore: 600, dueBeforeCount: 1, stillDue: 3000,
        })
        // To the piastre, as amounts are kept.
        const odd = statementTotals([charge({ paid: 0.1, fee: 0.2, total: 0.3 }), charge({ paid: 0.7, fee: 0, total: 0.7, collectedOn: "2026-10-03" })], { amount: 0.05, count: 1 })
        expect(odd).toMatchObject({ paid: 0.8, fees: 0.2, charged: 1, collected: 0.7, due: 0.3, stillDue: 0.35 })
    })

    it("says what's still due, from the period and before it, or that nothing is", () => {
        expect(statementNote(STATEMENT.totals)).toEqual({ key: "statement_note_both", tone: "waiting" })
        expect(statementNote({ ...STATEMENT.totals, dueBefore: 0, dueBeforeCount: 0 })).toEqual({ key: "statement_note_period", tone: "waiting" })
        expect(statementNote({ ...STATEMENT.totals, due: 0, dueCount: 0 })).toEqual({ key: "statement_note_before", tone: "waiting" })
        expect(statementNote({ ...STATEMENT.totals, due: 0, dueCount: 0, dueBefore: 0, dueBeforeCount: 0, stillDue: 0 })).toEqual({ key: "statement_note_clear", tone: "good" })
    })
})

describe("the sheet", () => {
    it("is the company's document, for the client, the period and the day it was issued", async () => {
        const html = await sheet()
        expect(html).toContain(`<p class="ui-doc-company">Nile Works</p><p class="ui-doc-kind">${en.statement_title}</p>`)
        expect(html).toContain(`<dt>${en.statement_client}</dt><dd><bdi>Al Noor Trading</bdi><span class="ui-detail-note"><bdi>Hassan Adel</bdi></span></dd>`)
        expect(html).toContain(`<dt>${en.doc_period}</dt><dd>1–31 October 2026</dd>`)
        expect(html).toContain(`<dt>${en.statement_issued_on}</dt><dd>8 November 2026</dd>`)
    })

    it("lists the charges in a document's table, oldest first, with Paid, Service fee, Total and status", async () => {
        const html = await sheet()
        expect(html).toContain(`<caption>${en.statement_charges}</caption>`)
        const heads = [...html.matchAll(/<th scope="col"( class="ui-end")?>([^<]*)<\/th>/g)].map(m => `${m[2]}${m[1] ? " (end)" : ""}`)
        expect(heads).toEqual([en.statement_col_date, en.statement_col_charge, `${en.charges_col_paid} (end)`, `${en.charges_col_fee} (end)`, `${en.charges_col_total} (end)`, en.charges_col_status])
        const rows = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"))
        expect([...rows.matchAll(/<tr>/g)]).toHaveLength(6)
        expect(rows).toContain(`<td class="ui-nowrap">2 Oct</td><td><span class="ui-doc-cell-title"><bdi>Spare parts</bdi></span><span class="ui-doc-cell-detail"><bdi>AC repair, 2nd floor</bdi></span><span class="ui-doc-cell-detail"><a href="#receipt-1">Receipt 1</a></span></td><td class="ui-end">1,850.00</td><td class="ui-end">150.00</td><td class="ui-end">2,000.00</td><td class="ui-nowrap">Collected 20 Oct</td>`)
        expect(rows).toContain(`<span class="ui-doc-cell-detail">${en.statement_no_receipt}</span>`)
        expect(rows).toContain(`<td class="ui-nowrap"><span class="ui-doc-due">${en.charges_status_due}</span></td>`)
        expect(rows.indexOf("Spare parts")).toBeLessThan(rows.indexOf("LED bulbs"))
        // Its foot counts them and sums the three amounts.
        expect(html).toContain(`<tfoot><tr><th scope="row" colSpan="2">6 charges</th><td class="ui-end">4,400.00</td><td class="ui-end">380.00</td><td class="ui-end">4,780.00</td><td></td></tr></tfoot>`)
    })

    it("is a block of lines for each charge on phones, its foot too", async () => {
        const html = await sheet()
        expect(html).toContain(`<ul class="ui-doc-cards" aria-label="${en.statement_charges}">`)
        expect([...html.matchAll(/<li class="ui-doc-card">/g)]).toHaveLength(6)
        expect(html).toContain(`<span class="ui-doc-card-day">2 Oct</span><span class="ui-doc-card-head"><bdi>Spare parts</bdi><bdi class="ui-doc-amount">2,000.00</bdi></span>`)
        expect(html).toContain(esc(en.statement_card_amounts.replace("{paid}", "1,850.00").replace("{fee}", "150.00")))
        expect(html).toContain(`<div class="ui-doc-cards-foot"><p class="ui-doc-cards-count">6 charges</p>`)
    })

    it("adds up to Still due, all of it, as its last total, with what's due from before as a line of its own", async () => {
        const html = await sheet()
        const parts = [
            line(en.statement_charged, "4,780.00"),
            line(en.statement_collected, "−2,380.00"),
            line(en.statement_due_before.replace("{date}", "1 October 2026"), "600.00"),
            total(en.statement_due, "3,000.00"),
        ]
        const at = parts.map(p => html.indexOf(p))
        expect(at.every(i => i > 0)).toBe(true)
        expect([...at].sort((a, b) => a - b)).toEqual(at)
        expect(html).toContain(`<p class="ui-doc-note" data-tone="waiting">${esc(en.statement_note_both.replace("{amount}", "3,000.00").replace("{charges}", "3 charges").replace("{older}", "1 charge"))}</p>`)
        // None due from before: no line for it.
        const none = await sheet({ totals: { ...STATEMENT.totals, dueBefore: 0, dueBeforeCount: 0, stillDue: 2400 } })
        expect(none).not.toContain(esc(en.statement_due_before.replace("{date}", "1 October 2026")))
        expect(none).toContain(`data-tone="waiting">${esc(en.statement_note_period.replace("{amount}", "2,400.00").replace("{charges}", "3 charges"))}</p>`)
    })

    it("says when nothing was charged in the period, and when nothing is due", async () => {
        const empty = await sheet({ charges: [], totals: statementTotals([], { amount: 0, count: 0 }) })
        expect(empty).toContain(`<p class="ui-doc-empty">${en.statement_none}</p>`)
        expect(empty).not.toContain("<table")
        expect(empty).toContain(`<p class="ui-doc-note" data-tone="good">${en.statement_note_clear}</p>`)
        expect(empty).not.toContain("ui-doc-receipts")
    })

    it("shows the receipts under Receipts, each with its number, and a PDF as a file of its own", async () => {
        const html = await sheet()
        const receipts = html.slice(html.indexOf('<section class="ui-doc-receipts"'))
        expect(receipts).toContain(`<h2 class="ui-doc-group-title">${en.statement_receipts}</h2>`)
        expect(receipts).toContain(`<p class="ui-doc-print-only ui-doc-receipts-for">${sentence(en.statement_receipts_for, { client: "<bdi>Al Noor Trading</bdi>", period: "1–31 October 2026" })}</p>`)
        expect([...receipts.matchAll(/<figure /g)]).toHaveLength(5)
        expect(receipts).toContain(`<figure id="receipt-1" class="ui-doc-receipt"><figcaption><span class="ui-doc-receipt-number">Receipt 1</span><span>${sentence(en.statement_receipt_what, { what: "<bdi>Spare parts</bdi>", date: "2 Oct" })}</span><span>${esc(en.statement_receipt_paid.replace("{amount}", "1,850.00"))}</span></figcaption><img class="ui-doc-receipt-photo" src="${RECEIPTS}/r1.jpg" alt="${esc(en.statement_receipt_alt.replace("{n}", "1"))}"/></figure>`)
        // The PDF: a link on screen, a word on paper.
        const pdf = receipts.slice(receipts.indexOf('id="receipt-3"'), receipts.indexOf('id="receipt-4"'))
        expect(pdf).toContain(`href="${RECEIPTS}/r4.pdf"`)
        expect(pdf).toContain(`<p class="ui-doc-print-only">${esc(en.statement_receipt_pdf)}</p>`)
        expect(pdf).not.toContain("<img")
    })

    it("leaves the receipts out, and their numbers, without With receipts", async () => {
        const html = await sheet({}, false)
        expect(html).not.toContain("ui-doc-receipts")
        expect(html).not.toContain("Receipt 1")
        expect(html).not.toContain(en.statement_no_receipt)
    })

    it("gives the year with each day where the period runs over two", async () => {
        const html = await sheet({ period: { from: "2026-12-15", to: "2027-01-14" }, charges: [charge({ id: "y", day: "2026-12-20", paid: 10, total: 10, collectedOn: "2027-01-02" })] })
        expect(html).toContain(`<td class="ui-nowrap">20 Dec 2026</td>`)
        expect(html).toContain(`<td class="ui-nowrap">Collected 2 Jan 2027</td>`)
    })

    it("is in the page's language, digits too", async () => {
        state.locale = "ar"
        const html = await sheet()
        expect(html).toContain(`<p class="ui-doc-kind">${ar.statement_title}</p>`)
        expect(html).toContain(`<dd>١–٣١ أكتوبر ٢٠٢٦</dd>`)
        expect(html).toContain(`<td class="ui-nowrap">٢ أكتوبر</td>`)
        expect(html).toContain(`<a href="#receipt-1">${ar.statement_receipt.replace("{n}", "١")}</a>`)
        expect(html).toContain(`<td class="ui-end">١٬٨٥٠٫٠٠</td>`)
        expect(html).toContain(`<td class="ui-nowrap">${ar.charges_collected_on.replace("{date}", "٢٠ أكتوبر")}</td>`)
        expect(html).toContain(total(ar.statement_due, "٣٬٠٠٠٫٠٠"))
        // What was bought is in the words it was written in, English here:
        // isolated, so it reads in its own direction inside an Arabic line.
        expect(html).toContain(`<span class="ui-doc-cell-title"><bdi>Spare parts</bdi></span>`)
        expect(html).toContain(`<span class="ui-doc-card-head"><bdi>Spare parts</bdi>`)
        expect(html).toContain(sentence(ar.statement_receipt_what, { what: "<bdi>Spare parts</bdi>", date: "٢ أكتوبر" }))
        expect(html).toContain(sentence(ar.statement_receipts_for, { client: "<bdi>Al Noor Trading</bdi>", period: "١–٣١ أكتوبر ٢٠٢٦" }))
    })
})

describe("the server", () => {
    const service = read("lib/services/client-statement.service.ts")

    it("is for whoever sees all the company's charges, before anything is read", () => {
        expect(service).toContain('if (!canCompanyWide(user, "charges.view")) throw new Error("STATEMENT_COMPANY_WIDE")')
        expect(service.indexOf("canCompanyWide(")).toBeLessThan(service.indexOf("prisma.client.findUnique"))
        // Another company's client is none of theirs; a Super Admin's is any.
        expect(service).toContain('if (!client || (user.role !== "SUPER_ADMIN" && client.companyId !== user.companyId)) throw new Error("CLIENT_NOT_FOUND")')
    })

    it("picks the client's charges in the company's own days, none left off the bill, and no more than one statement holds", () => {
        expect(service).toContain("filterTimeZone(client.companyId)")
        expect(service).toContain("dayRange(period.from, period.to, timeZone)")
        expect(service).toMatch(/notCharged: false, createdAt: range, task: tasks/)
        expect(service).toContain("take: STATEMENT_MAX_CHARGES + 1")
        expect(service).toContain('if (rows.length > STATEMENT_MAX_CHARGES) throw new Error("STATEMENT_TOO_MANY")')
        expect(STATEMENT_MAX_CHARGES).toBe(200)
    })

    it("answers at /api/charges/statement, as the charges' own, under Costs", () => {
        const route = read("app/api/charges/statement/route.ts")
        expect(route).toContain("clientStatement(session.user as Actor & { id: string }")
        expect(route).toContain('{ permission: "charges.view" }')
        expect(moduleForApiPath("/api/charges/statement")).toBe("COSTS")
        expect(read("app/(dashboard)/dashboard/clients/[id]/statement/layout.tsx")).toContain("guardModule('COSTS')")
    })

    it("says what's wrong when it refuses", () => {
        expect(KNOWN_REFUSALS.STATEMENT_COMPANY_WIDE?.status).toBe(403)
        expect(KNOWN_REFUSALS.STATEMENT_TOO_MANY?.status).toBe(400)
        expect(KNOWN_REFUSALS.STATEMENT_TOO_MANY?.message).toContain("200")
        expect(KNOWN_REFUSALS.STATEMENT_CLIENT_REQUIRED?.status).toBe(400)
    })
})

describe("the page and the button", () => {
    it("opens from Statement on the client's Charges, for whoever sees all the company's charges", () => {
        const list = read("components/charges/ChargesList.tsx")
        expect(list).toContain("companyWide('charges.view') && <ButtonLink size=\"sm\" icon={FileTextIcon} href={statementHref(onPage.id, dateFrom, dateTo)}>{t('statement_open')}</ButtonLink>")
    })

    it("keeps the period and With receipts in its address, prints with Print, and says what's too many", () => {
        const page = read("app/(dashboard)/dashboard/clients/[id]/statement/page.tsx")
        expect(page).toContain("const withReceipts = params.get('receipts') !== '0'")
        expect(page).toContain("<DateRangePicker")
        expect(page).toContain("onClick={() => window.print()}")
        expect(page).toContain("t('statement_pdf_hint')")
        expect(page).toContain("code === 'STATEMENT_TOO_MANY'")
    })

    it("breaks a word with no space in it, such as a link, rather than pushing the amounts out of the sheet", () => {
        // A charge described with a link put its total outside the sheet on
        // a phone: the link was the narrowest its title could go.
        const css = read("components/ui/ui.css")
        expect(css).toMatch(/\.ui-doc-cell-title,\s*\.ui-doc-cell-detail \{[^}]*overflow-wrap: anywhere;/)
        expect(css).toMatch(/\.ui-doc-card-head > :first-child,\s*\.ui-doc-card-detail \{\s*min-width: 0;\s*overflow-wrap: anywhere;/)
    })

    it("prints its receipts from a new page, its table's foot once and its rows whole, and its rules in a grey that prints", () => {
        const css = read("components/ui/ui.css")
        const print = css.slice(css.indexOf("/* A client statement, printed"))
        expect(print).toMatch(/\.ui-doc-receipts \{[^}]*break-before: page;/)
        expect(print).toMatch(/\.ui-doc-table tr \{[^}]*break-inside: avoid;/)
        // Chromium repeats a table's foot at the foot of each page: its sums
        // then stood under the first page's rows as if they were all.
        expect(print).toMatch(/\.ui-doc-table tfoot \{\s*display: table-row-group;/)
        expect(print).toMatch(/\.ui-doc-receipt-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
        // The receipts' page is headed as the sheet is, the line under it smaller.
        expect(print).toMatch(/\.ui-doc-receipts > \.ui-doc-group-title \{\s*font-size: var\(--text-xl\);\s*line-height: var\(--leading-xl\);/)
        expect(css).toMatch(/\.ui-doc-receipts-for \{\s*font-size: var\(--text-sm\);\s*line-height: var\(--leading-sm\);/)
        const globals = read("app/globals.css")
        expect(globals).toMatch(/--rule-on-paper: #[0-9a-f]{6};/)
        expect(globals.slice(globals.indexOf(".print-document {"))).toContain("--rule: var(--rule-on-paper);")
    })
})

describe("the words", () => {
    const KEYS = [
        "statement_open", "statement_title", "statement_with_receipts", "statement_pdf_hint", "statement_client", "statement_issued_on",
        "statement_charges", "statement_col_date", "statement_col_charge", "statement_receipt", "statement_no_receipt", "statement_none",
        "statement_card_amounts", "statement_charged", "statement_collected", "statement_due_before", "statement_due",
        "statement_note_both", "statement_note_period", "statement_note_before", "statement_note_clear",
        "statement_receipts", "statement_receipts_for", "statement_receipt_what", "statement_receipt_paid", "statement_receipt_alt",
        "statement_receipt_pdf", "statement_receipt_open", "statement_too_many",
    ]

    it("are in both languages, with the same places to fill", () => {
        for (const key of KEYS) {
            const [e, a] = [(en as Record<string, string>)[key], (ar as Record<string, string>)[key]]
            expect(e, key).toBeTruthy()
            expect(a, key).toBeTruthy()
            expect([...a.matchAll(/\{[a-z]+\}/g)].map(m => m[0]).sort(), key).toEqual([...e.matchAll(/\{[a-z]+\}/g)].map(m => m[0]).sort())
        }
        expect(en.statement_too_many).toContain("{max}")
    })

    // Gender-neutral Arabic, and the app never speaks as "we".
    it("ask nothing in the masculine in Arabic, and never speak as we", () => {
        for (const key of KEYS) {
            expect((ar as Record<string, string>)[key], key).not.toMatch(/(^|[\s،.:—]|و)(أدخل|اختر|حاول|اكتب|سجّل|تابع|أكّد|انتظر|افتح|اطبع|احفظ|معه|لديه|عنده)([\s،.:—]|$)|هل أنت متأكد|هل تريد|أنك تريد|نحن|لدينا/)
            expect((en as Record<string, string>)[key], key).not.toMatch(/\b(we|our|us)\b/i)
        }
    })
})
