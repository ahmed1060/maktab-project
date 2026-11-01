import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A payslip and a settlement statement on the building blocks (UI_PLAN.md §5
 * step 5, Documents part 2; DESIGN.md §5.5, Document): the page header with
 * Print, and the sheet: the company's head, the facts as details, lines with
 * their amounts at the end, totals under a rule, notes with their meaning's
 * bar, in the page's language; and a document that isn't there, or didn't
 * load, each saying so.
 */

type Shown = { data?: unknown; error?: unknown }
const state = { locale: "en" as "en" | "ar", shown: {} as Shown }
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "d1" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => ({ data: undefined, error: undefined, isLoading: !state.shown.data && !state.shown.error, isValidating: false, mutate: async () => {}, ...(key ? state.shown : {}) }),
}))

const company = { name: "Delta Sites", logoUrl: "/logo.png" }
const PAYSLIP = {
    person: { name: "Youssef Adel", email: "y@x.test" }, company, period: { month: 10, year: 2026 }, status: "APPROVED",
    daysPaid: 31, excluded: false, earnings: 12500, deductions: 750.5, net: 11749.5, carried: 0,
    lines: [{ kind: "EARNING", label: "Salary", amount: 12000 }, { kind: "EARNING", label: "Overtime", amount: 500 }, { kind: "DEDUCTION", label: "Lateness", amount: 750.5 }],
}
const SETTLEMENT = {
    person: { name: "Rami Nabil", email: "r@x.test" }, company, lastWorkingDay: "2026-10-15", dueDate: "2026-10-22",
    earned: 6000, paid: 2000, net: 4000, debtRecovered: 500, payable: 3500, direction: "COMPANY_OWES", status: "ISSUED", reason: "Resigned", emailedAt: null,
}
const refused = (status: number) => ({ error: Object.assign(new Error("Request failed"), { status, info: { error: status === 500 ? "Database unavailable" : "Not found" } }) })
const amount = (n: number, locale = "en-EG") => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

async function payslip({ shown = { data: { data: PAYSLIP } } as Shown, locale = "en" as "en" | "ar" } = {}) {
    state.locale = locale
    state.shown = shown
    const { default: Page } = await import("@/app/(dashboard)/dashboard/documents/payslip/[id]/page")
    return renderToStaticMarkup(h(Page))
}
async function settlement({ shown = { data: { data: SETTLEMENT } } as Shown, locale = "en" as "en" | "ar" } = {}) {
    state.locale = locale
    state.shown = shown
    const { default: Page } = await import("@/app/(dashboard)/dashboard/documents/settlement/[id]/page")
    return renderToStaticMarkup(h(Page))
}
const sheet = (html: string) => html.slice(html.indexOf('<article class="ui-panel ui-doc print-document">'), html.indexOf("</article>") + 10)

describe("the sheet", () => {
    it("is a panel with the company's name, the document's name and its logo at its head", async () => {
        const { DocumentSheet } = await import("@/components/ui")
        const html = renderToStaticMarkup(h(DocumentSheet, { title: "Payslip", company, children: "…" }))
        expect(html).toContain('<article class="ui-panel ui-doc print-document"><header class="ui-doc-head"><div><p class="ui-doc-company">Delta Sites</p><p class="ui-doc-kind">Payslip</p></div>')
        expect(html).toContain('<img src="/logo.png" alt="" class="ui-doc-logo"/>')
    })

    it("lines up its lines' amounts, an amount taken off with a minus sign, and its totals under a rule", async () => {
        const { DocLine, DocTotal, DocNote } = await import("@/components/ui")
        expect(renderToStaticMarkup(h(DocLine, { label: "Lateness", amount: "750.50", minus: true })))
            .toBe('<div class="ui-doc-line"><span>Lateness</span><bdi class="ui-doc-amount">−750.50</bdi></div>')
        expect(renderToStaticMarkup(h(DocTotal, { label: "Net pay", amount: "11,749.50" })))
            .toBe('<div class="ui-doc-line ui-doc-total"><span>Net pay</span><bdi class="ui-doc-amount">11,749.50</bdi></div>')
        expect(renderToStaticMarkup(h(DocNote, { tone: "waiting", children: "A draft" }))).toBe('<p class="ui-doc-note" data-tone="waiting">A draft</p>')
    })

    it("has its look in the building blocks' styles, and prints alone", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        for (const rule of [".ui-doc {", ".ui-doc-head {", ".ui-doc-line {", ".ui-doc-total {", '.ui-doc-note[data-tone="waiting"]']) expect(css).toContain(rule)
        const global = readFileSync("app/globals.css", "utf8")
        expect(global).toMatch(/\.print-document,[\s\S]*?visibility: visible/)
        // The building blocks' styles load after the global ones, so the
        // sheet's own print look is beside its screen look, or the panel's
        // padding, border and dark-mode fill would win on paper.
        const print = css.slice(css.indexOf("@media print"))
        expect(css.indexOf("@media print")).toBeGreaterThan(css.indexOf(".ui-doc {"))
        expect(print).toMatch(/\.ui-doc \{[^}]*padding: 0;[^}]*max-width: none;[^}]*border: none;[^}]*box-shadow: none;[^}]*background: var\(--paper\);/)
    })
})

describe("a payslip", () => {
    it("has the page header with Print, above the sheet so it isn't printed", async () => {
        const html = await payslip()
        expect(html).toContain(`<h1 class="ui-page-title">${en.doc_payslip}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">October 2026</p>`)
        expect(html).toMatch(/<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary">.*Print<\/button><\/div>/)
        expect(html.indexOf("ui-page-actions")).toBeLessThan(html.indexOf("print-document"))
        expect(sheet(html)).not.toContain("<button")
    })

    it("gives its facts as details, its lines in groups with their totals, and the net last", async () => {
        const doc = sheet(await payslip())
        expect(doc).toContain(`<dt>${en.doc_issued_to}</dt><dd>Youssef Adel</dd>`)
        expect(doc).toContain(`<dt>${en.doc_period}</dt><dd>October 2026</dd>`)
        expect(doc).toContain(`<dt>${en.doc_days_paid}</dt><dd>31</dd>`)
        expect(doc).toContain(`<h2 class="ui-doc-group-title">${en.doc_earnings}</h2>`)
        expect(doc).toContain(`<span>Salary</span><bdi class="ui-doc-amount">${amount(12000)}</bdi>`)
        expect(doc).toContain(`<span>Lateness</span><bdi class="ui-doc-amount">−${amount(750.5)}</bdi>`)
        expect(doc).toContain(`<div class="ui-doc-line ui-doc-total"><span>${en.doc_deductions}</span><bdi class="ui-doc-amount">−${amount(750.5)}</bdi></div>`)
        const net = `<div class="ui-doc-line ui-doc-total"><span>${en.doc_net}</span><bdi class="ui-doc-amount">${amount(11749.5)}</bdi></div>`
        expect(doc).toContain(net)
        expect(doc.lastIndexOf("ui-doc-total")).toBe(doc.indexOf(net) + '<div class="ui-doc-line '.length)
    })

    it("says on its face that a draft isn't final, and what the deductions couldn't take", async () => {
        const doc = sheet(await payslip({ shown: { data: { data: { ...PAYSLIP, status: "DRAFT", carried: 250 } } } }))
        expect(doc).toContain(`<p class="ui-doc-note" data-tone="waiting">${en.doc_draft_note}</p>`)
        expect(doc).toContain(en.doc_carried_note.replace("{amount}", amount(250)))
    })

    it("is in the page's language, digits too", async () => {
        const doc = sheet(await payslip({ locale: "ar" }))
        const october = new Date(2026, 9).toLocaleString("ar-EG", { month: "long", year: "numeric" })
        expect(doc).toContain(`<dt>${ar.doc_period}</dt><dd>${october}</dd>`)
        expect(doc).toContain(`<dt>${ar.doc_days_paid}</dt><dd>${(31).toLocaleString("ar-EG")}</dd>`)
        expect(doc).toContain(amount(11749.5, "ar-EG"))
    })

    it("says it's loading, that it isn't there or isn't theirs, or that it didn't load, with Try again", async () => {
        expect(await payslip({ shown: {} })).toContain('<div class="ui-panel" role="status">')
        for (const status of [403, 404]) {
            const html = await payslip({ shown: refused(status) })
            expect(html).toContain(`<p class="ui-empty-title">${en.doc_not_found}</p>`)
            expect(html).not.toContain(">Try again</button>")
        }
        const failed = await payslip({ shown: refused(500) })
        expect(failed).toContain(en.doc_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
        expect(failed).not.toContain(en.doc_not_found)
    })
})

describe("a settlement statement", () => {
    it("has the page header with Send by email beside Print", async () => {
        const html = await settlement()
        expect(html).toContain(`<h1 class="ui-page-title">${en.doc_settlement}</h1>`)
        expect(html).toMatch(new RegExp(`<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-secondary">${en.doc_send}</button><button type="button" class="ui-btn ui-btn-primary">.*Print</button></div>`))
        expect(await settlement({ shown: { data: { data: { ...SETTLEMENT, emailedAt: "2026-10-16T09:00:00Z" } } } })).toContain(`>${en.doc_send_again}</button>`)
    })

    it("shows both sides, the net, what was taken back and what's to be paid", async () => {
        const doc = sheet(await settlement())
        expect(doc).toContain(`<dt>${en.doc_last_working_day}</dt><dd>15 October 2026</dd>`)
        expect(doc).toContain(`<span>${en.doc_earned}</span><bdi class="ui-doc-amount">${amount(6000)}</bdi>`)
        expect(doc).toContain(`<span>${en.doc_already_paid}</span><bdi class="ui-doc-amount">−${amount(2000)}</bdi>`)
        expect(doc).toContain(`<div class="ui-doc-line ui-doc-total"><span>${en.doc_net}</span>`)
        expect(doc).toContain(`<span>${en.doc_debt_recovered}</span><bdi class="ui-doc-amount">−${amount(500)}</bdi>`)
        expect(doc).toContain(`<div class="ui-doc-line ui-doc-total"><span>${en.doc_payable}</span><bdi class="ui-doc-amount">${amount(3500)}</bdi></div>`)
        expect(doc).toContain(`${en.doc_reason}: Resigned`)
    })

    it("says who owes whom in words, in the colour of what it means for the person", async () => {
        const verdict = async (direction: string) => sheet(await settlement({ shown: { data: { data: { ...SETTLEMENT, direction } } } }))
        expect(await verdict("COMPANY_OWES")).toContain(`<p class="ui-doc-note" data-tone="good">${en.doc_company_owes}</p>`)
        expect(await verdict("PERSON_OWES")).toContain(`<p class="ui-doc-note" data-tone="problem">${en.doc_person_owes}</p>`)
        expect(await verdict("SETTLED")).toContain(`<p class="ui-doc-note" data-tone="neutral">${en.doc_settled}</p>`)
    })

    it("says it isn't there, or that it didn't load", async () => {
        expect(await settlement({ shown: refused(404) })).toContain(`<p class="ui-empty-title">${en.doc_not_found}</p>`)
        expect(await settlement({ shown: refused(500) })).toContain(">Try again</button>")
    })
})

describe("on paper (the audit, PR 155)", () => {
    it("has no phone padding: paper is narrower than a computer's screen too", () => {
        // The phone rule matched a page as narrow as A4 between its margins,
        // and came after the print one, so a printed sheet was inset twice.
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/@media screen and \(max-width: 767px\) \{\s*\.ui-doc \{\s*padding: var\(--space-4\);/)
        const phones = css.split("@media (max-width: 767px)").slice(1).map(block => block.slice(0, block.indexOf("\n}")))
        for (const block of phones) expect(block).not.toMatch(/\.ui-doc \{/)
    })

    it("has its notes' bars in colours that show on white, from dark mode too", () => {
        // Dark mode's are pale, for a dark ground: on paper they all but vanished.
        const global = readFileSync("app/globals.css", "utf8")
        const print = global.slice(global.indexOf("@media print"))
        for (const [token, paper] of [["--status-neutral-fg", "--neutral-on-paper"], ["--status-waiting-fg", "--waiting-on-paper"], ["--status-good-fg", "--good-on-paper"], ["--problem-text", "--problem-on-paper"]]) {
            expect(print.slice(0, print.indexOf("@page"))).toContain(`${token}: var(${paper});`)
            expect(global.match(new RegExp(`${paper}: #[0-9a-f]{6};`, "g"))).toHaveLength(1)
        }
    })

    it("puts no minus sign on nothing", async () => {
        const doc = sheet(await settlement({ shown: { data: { data: { ...SETTLEMENT, earned: 0, paid: 0, net: 0, debtRecovered: 0, payable: 0, direction: "SETTLED" } } } }))
        expect(doc).toContain(`<span>${en.doc_already_paid}</span><bdi class="ui-doc-amount">${amount(0)}</bdi>`)
        const slip = sheet(await payslip({ shown: { data: { data: { ...PAYSLIP, deductions: 0, lines: [...PAYSLIP.lines, { kind: "DEDUCTION", label: "Advance", amount: 0 }].filter(l => l.label !== "Lateness") } } } }))
        expect(slip).toContain(`<span>Advance</span><bdi class="ui-doc-amount">${amount(0)}</bdi>`)
        expect(slip).toContain(`<span>${en.doc_deductions}</span><bdi class="ui-doc-amount">${amount(0)}</bdi>`)
    })
})

describe("nothing of the old sheets is left", () => {
    it("has no styles typed in, spinner or old buttons", () => {
        for (const file of ["app/(dashboard)/dashboard/documents/payslip/[id]/page.tsx", "app/(dashboard)/dashboard/documents/settlement/[id]/page.tsx", "components/ui/Document.tsx"]) {
            const src = readFileSync(file, "utf8")
            expect(src).not.toContain("style={")
            expect(src).not.toContain("LoadingSpinner")
            expect(src).not.toContain('className="btn')
            expect(src).not.toContain("textTransform")
        }
    })
})
