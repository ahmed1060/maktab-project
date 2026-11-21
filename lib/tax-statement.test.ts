import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { NIZMO_MESSAGES } from "./client-message-template"
import { stripComments } from "./strip-comments"
import { paidShare, summarise, type PortalTaxPosition } from "./portal-tax"
import { daysLate, type TaxClaimRow } from "./tax-claims"
import { statementStatuses, statementTitle, type TaxStatement } from "./tax-statement"
import { DEFAULT_POWERED_BY_NAME } from "./branding-defaults"

/**
 * The tax position statement in the client's area (CLIENT_PORTAL_PLAN.md
 * §8, §12 step 12a; DESIGN.md §5.5, Tax position statement; PR 352): the
 * page at /portal/statement, the sheet, and Download the statement on the
 * client's own page, as the owner's mockup draws them (the Tax position
 * statement canvas). All its figures, names and numbers are made up.
 */

const state = {
    locale: "en" as "en" | "ar",
    session: null as null | { user: Record<string, unknown> },
    read: [] as { companyId: string; clientId: string }[],
    position: null as null | PortalTaxPosition | Error,
    accountant: null as null | { name: string; whatsappNumber: string | null },
    accountantRead: [] as string[],
    frame: null as null | { company: { name: string; logoUrl: string | null }; brand: string | null },
    frameRead: [] as unknown[],
    settings: { showPoweredBy: true, poweredByName: "Nizmo" },
    cookie: undefined as string | undefined,
    acceptLanguage: null as string | null,
}

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({
    redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
    useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}))
vi.mock("@/lib/services/tax-claim.service", () => ({
    portalTaxPosition: async (account: { companyId: string; clientId: string }) => {
        state.read.push(account)
        if (state.position instanceof Error) throw state.position
        return state.position
    },
}))
vi.mock("@/lib/services/client-accountant.service", () => ({
    portalAccountant: async (clientId: string) => {
        state.accountantRead.push(clientId)
        return state.accountant
    },
}))
vi.mock("@/lib/client-portal-frame", () => ({
    portalFrame: async (viewer: unknown) => {
        state.frameRead.push(viewer)
        return state.frame
    },
}))
vi.mock("@/lib/services/system-settings.service", () => ({ pageSystemSettings: async () => state.settings }))
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: (name: string) => (name === "NEXT_LOCALE" && state.cookie ? { value: state.cookie } : undefined) }),
    headers: async () => ({ get: (name: string) => (name === "accept-language" ? state.acceptLanguage : null) }),
}))
vi.mock("@/lib/services/client-message-template.service", () => ({ clientMessages: async () => NIZMO_MESSAGES }))

const { TaxStatementPage, TaxStatementSheet } = await import("@/components/tax/TaxStatement")
const { PortalHome } = await import("@/components/portal/PortalHome")
const { SESSION_ENDED_PATH } = await import("./session-ended")

const TODAY = "2026-11-21"
const AS_OF = "2026-11-16"
const claim = (id: string, item: string, original: number, paid: number, dueDate: string, periodStart: string | null = null, periodEnd: string | null = null): TaxClaimRow => ({
    id, claimNumber: `00011800000${id}`, item, taxType: null, registrationType: null,
    originalAmount: original, paidAmount: paid, remainingAmount: Math.round((original - paid) * 100) / 100,
    currency: "جنيه مصري", status: null, periodStart, periodEnd, dueDate, daysLate: daysLate(dueDate, TODAY),
})
const VAT = "إقرار القيمة المضافة"
const INCOME = "إقرار ضريبة الدخل"
const HEALTH = "مساهمة تكافلية - تأمين صحي"
const TRADE = "إقرار تجاري"
/**
 * Made-up claims, as the mockup has them: three of one item, one spelled as
 * the portal sometimes does; one paid in part and late; one not due yet; and
 * one paid in part, not due yet, with no period.
 */
const CLAIMS = [
    claim("1", VAT, 7200, 0, "2026-10-31", "2026-09-01", "2026-09-30"),
    claim("2", VAT, 9850, 0, "2025-03-31", "2025-02-01", "2025-02-28"),
    claim("3", "اقرار القيمه المضافه", 12400, 4000, "2025-02-28", "2025-01-01", "2025-01-31"),
    claim("4", INCOME, 15300, 3365, "2026-04-30", "2025-01-01", "2025-12-31"),
    claim("5", HEALTH, 1600, 0, "2026-12-31", "2026-07-01", "2026-09-30"),
    claim("6", HEALTH, 1413.37, 0, "2026-07-31", "2026-04-01", "2026-06-30"),
    claim("7", TRADE, 500, 200, "2026-12-15"),
]
// Oldest due first, as the area reads them (portalTaxPosition).
const POSITION = summarise([...CLAIMS].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)), TODAY, AS_OF)
const COMPANY = { name: "Nile Accounts", logoUrl: null }
const STATEMENT: TaxStatement = { company: COMPANY, client: "Al Noor Trading", accountant: "Karim Saeed", position: POSITION, signature: { show: true, name: "Nizmo" } }

const render = (statement: TaxStatement = STATEMENT, locale: "en" | "ar" = "en") => {
    state.locale = locale
    return renderToStaticMarkup(h(TaxStatementPage, { statement, home: "/portal" }))
}
const sheet = (statement: TaxStatement = STATEMENT, locale: "en" | "ar" = "en") => {
    state.locale = locale
    return renderToStaticMarkup(h(TaxStatementSheet, { statement }))
}
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
/** The table's part, from its caption to its end. */
const table = (html: string) => html.slice(html.indexOf("<table"), html.indexOf("</table>"))
/** The rows of the table's body, as text, cell by cell. */
const rows = (html: string) => [...table(html).replace(/<tfoot>[\s\S]*$/, "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1)
    .map(row => [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(cell => text(cell[1])))
const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
const source = (path: string) => stripComments(readFileSync(path, "utf8"))

/** The body of the rule whose selector is exactly this one, outside any media block. */
function rule(selector: string): string {
    const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"))
    expect([selector, at >= 0]).toEqual([selector, true])
    const open = css.indexOf("{", at + 1)
    return css.slice(open + 1, css.indexOf("}", open))
}
/** What's inside the media blocks with this head, all of them together. */
function media(head: RegExp): string {
    const parts: string[] = []
    let m: RegExpExecArray | null
    while ((m = head.exec(css))) {
        let depth = 1, i = m.index + m[0].length
        const from = i
        for (; i < css.length && depth > 0; i++) {
            if (css[i] === "{") depth++
            else if (css[i] === "}") depth--
        }
        parts.push(css.slice(from, i - 1))
    }
    return parts.join("\n")
}
const inMedia = (head: RegExp, selector: string) => {
    const body = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(media(head))?.[1]
    expect([selector, body !== undefined]).toEqual([selector, true])
    return body ?? ""
}
const PHONE = /@media screen and \(max-width: 767px\) \{/g
const PRINT = /@media print \{/g

beforeEach(() => {
    state.locale = "en"
    state.session = null
    state.read = []
    state.position = null
    state.accountant = null
    state.accountantRead = []
    state.frame = null
    state.frameRead = []
    state.settings = { showPoweredBy: true, poweredByName: "Nizmo" }
    state.cookie = undefined
    state.acceptLanguage = null
})

describe("a claim's status on the statement", () => {
    it("Late, with Partly paid under it where some is paid; Partly paid alone; or Not due yet", () => {
        expect(statementStatuses({ daysLate: 21, paidAmount: 0 })).toEqual(["late"])
        expect(statementStatuses({ daysLate: 631, paidAmount: 4000 })).toEqual(["late", "partly_paid"])
        expect(statementStatuses({ daysLate: 0, paidAmount: 200 })).toEqual(["partly_paid"])
        expect(statementStatuses({ daysLate: 0, paidAmount: 0 })).toEqual(["not_due"])
    })
})

describe("its title, which names the PDF", () => {
    it("the client and the day the figures are from, on one line", () => {
        expect(statementTitle(en.tax_statement_file, "Al Noor Trading", "16 Nov 2026")).toBe("Al Noor Trading, tax position statement, 16 Nov 2026")
        expect(statementTitle(ar.tax_statement_file, "شركة النور للتجارة", "١٦ نوفمبر ٢٠٢٦")).toBe("شركة النور للتجارة، كشف الموقف الضريبي، ١٦ نوفمبر ٢٠٢٦")
        // A name kept over two lines, or with runs of spaces, is one line in a title.
        expect(statementTitle(en.tax_statement_file, "Al Noor\n  Trading ", "16 Nov 2026")).toBe("Al Noor Trading, tax position statement, 16 Nov 2026")
    })

    it("comes with the page from the server, in the page's language, as Next.js sends a page's title after it", async () => {
        const { generateMetadata } = await import("@/app/(portal)/portal/statement/page")
        state.session = { user: { id: "acct-1", role: "CLIENT_ACCOUNT", companyId: "co-1", clientId: "client-1", clientName: "Al Noor Trading" } }
        state.position = POSITION
        expect(await generateMetadata()).toEqual({ title: "Al Noor Trading, tax position statement, 16 Nov 2026" })
        state.cookie = "ar"
        expect(await generateMetadata()).toEqual({ title: "Al Noor Trading، كشف الموقف الضريبي، ١٦ نوفمبر ٢٠٢٦" })
        // The cookie's language first, else the browser's, as the page's own.
        state.cookie = undefined
        state.acceptLanguage = "ar-EG,ar;q=0.9"
        expect((await generateMetadata()).title).toContain("كشف الموقف الضريبي")
        // Nothing of its own before the first upload, or for anyone else.
        state.position = summarise([], TODAY, null)
        expect(await generateMetadata()).toEqual({})
        state.position = POSITION
        state.session = { user: { id: "u1", role: "ADMIN", companyId: "co-1" } }
        expect(await generateMetadata()).toEqual({})
        state.session = null
        expect(await generateMetadata()).toEqual({})
        state.session = { user: { id: "acct-1", role: "CLIENT_ACCOUNT", companyId: "co-1", clientId: "client-1", clientName: "Al Noor Trading" } }
        state.position = new Error("CLIENT_NOT_FOUND")
        expect(await generateMetadata()).toEqual({})
    })

    it("is set again in the browser once the figures are there, following a change of language", () => {
        const page = source("components/tax/TaxStatement.tsx")
        expect(page).toMatch(/useEffect\(\(\) => \{\s*if \(title\) document\.title = title\s*\}, \[title\]\)/)
        expect(page).toMatch(/statementTitle\(t\('tax_statement_file'\), client, formatDay\(asOf, locale\)\)/)
    })
})

describe("what the page at /portal/statement is given", () => {
    const user = { id: "acct-1", role: "CLIENT_ACCOUNT", companyId: "co-1", clientId: "client-1", clientName: "Al Noor Trading", name: "Mona Adel" }

    it("the session's client's position, with the accountant its page names, the company's name and logo, and the signature as System settings has it", async () => {
        state.session = { user }
        state.position = POSITION
        state.accountant = { name: "Karim Saeed", whatsappNumber: "+201001234567" }
        state.frame = { company: { name: "Nile Accounts", logoUrl: "https://example.com/logo.png" }, brand: null }
        state.settings = { showPoweredBy: false, poweredByName: "Nizmo Cloud" }
        const { default: Page } = await import("@/app/(portal)/portal/statement/page")
        const page = await Page() as ReactElement<{ statement: TaxStatement; home: string }>
        expect(state.read).toEqual([{ companyId: "co-1", clientId: "client-1" }])
        expect(state.accountantRead).toEqual(["client-1"])
        expect(state.frameRead).toEqual([user])
        expect(page.type).toBe(TaxStatementPage)
        expect(page.props).toEqual({
            statement: {
                company: { name: "Nile Accounts", logoUrl: "https://example.com/logo.png" },
                client: "Al Noor Trading",
                // The name alone: the number isn't the statement's.
                accountant: "Karim Saeed",
                position: POSITION,
                signature: { show: false, name: "Nizmo Cloud" },
            },
            home: "/portal",
        })
    })

    it("no accountant is no one named", async () => {
        state.session = { user }
        state.position = POSITION
        state.frame = { company: COMPANY, brand: null }
        const { default: Page } = await import("@/app/(portal)/portal/statement/page")
        const page = await Page() as ReactElement<{ statement: TaxStatement }>
        expect(page.props.statement.accountant).toBeNull()
        expect(page.props.statement.signature).toEqual({ show: true, name: "Nizmo" })
    })

    it("reads nothing from the address", () => {
        expect(readFileSync("app/(portal)/portal/statement/page.tsx", "utf8")).not.toMatch(/params|searchParams/)
    })

    it("a client no longer there ends the session, and anything else that goes wrong is thrown", async () => {
        state.session = { user }
        state.frame = { company: COMPANY, brand: null }
        const { default: Page } = await import("@/app/(portal)/portal/statement/page")
        state.position = new Error("CLIENT_NOT_FOUND")
        await expect(Page()).rejects.toThrow(`REDIRECT ${SESSION_ENDED_PATH}`)
        state.position = new Error("connection lost")
        await expect(Page()).rejects.toThrow("connection lost")
        expect(state.accountantRead).toEqual([])
    })

    it("nothing is read for a session that isn't a client account's", async () => {
        const { default: Page } = await import("@/app/(portal)/portal/statement/page")
        await expect(Page()).rejects.toThrow(`REDIRECT ${SESSION_ENDED_PATH}`)
        state.session = { user: { id: "u1", role: "ADMIN", companyId: "co-1" } }
        await expect(Page()).rejects.toThrow("REDIRECT /dashboard")
        state.session = { user: { ...user, clientId: null } }
        await expect(Page()).rejects.toThrow(`REDIRECT ${SESSION_ENDED_PATH}`)
        expect(state.read).toEqual([])
        expect(state.accountantRead).toEqual([])
        expect(state.frameRead).toEqual([])
    })
})

describe("above the sheet", () => {
    it("the client's name above Tax position statement, the hint about a PDF, and Print and Close", () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = render(STATEMENT, locale)
            expect(html, locale).toContain(`<p class="ui-page-overline">Al Noor Trading</p><h1 class="ui-page-title">${esc(words.tax_statement_title)}</h1><p class="ui-page-subtitle">${esc(words.statement_pdf_hint)}</p>`)
            const actions = html.slice(html.indexOf(`<div class="ui-page-actions">`), html.indexOf("</header>"))
            expect(actions, locale).toMatch(new RegExp(`^<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary">.*${esc(words.doc_print)}</button><button type="button" class="ui-btn ui-btn-secondary">${esc(words.close)}</button></div>$`))
        }
    })

    it("Print prints, and Close closes the tab, going back to the area's page where the browser won't", () => {
        const page = source("components/tax/TaxStatement.tsx")
        expect(page).toContain("onClick={() => window.print()}")
        expect(page).toMatch(/const close = \(\) => \{\s*window\.close\(\)\s*window\.setTimeout\(\(\) => router\.replace\(home\), 300\)\s*\}/)
    })

    it("before the first upload: the empty state the client's page has, and nothing to print", () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = render({ ...STATEMENT, position: summarise([], TODAY, null) }, locale)
            expect(html, locale).toContain(`<p class="ui-empty-title">${esc(words.portal_tax_none)}</p><p class="ui-empty-detail">${esc(words.portal_tax_none_detail)}</p>`)
            expect(html, locale).not.toContain("ui-doc")
            expect(html, locale).not.toContain(esc(words.doc_print))
            expect(html, locale).not.toContain("ui-page-subtitle")
            expect(html, locale).toContain(`>${esc(words.close)}</button>`)
        }
    })
})

describe("the sheet", () => {
    it("the company's name, with Tax position statement under it, and its logo where it has one", () => {
        expect(sheet()).toContain(`<header class="ui-doc-head"><div><p class="ui-doc-company">Nile Accounts</p><p class="ui-doc-kind">Tax position statement</p></div></header>`)
        expect(sheet({ ...STATEMENT, company: { name: "Nile Accounts", logoUrl: "https://example.com/logo.png" } })).toContain(`<img src="https://example.com/logo.png" alt="" class="ui-doc-logo"/>`)
        expect(sheet(STATEMENT, "ar")).toContain(`<p class="ui-doc-kind">كشف الموقف الضريبي</p>`)
    })

    it("its details: the client, the day the figures are from and where, the accountant, and the day it was printed", () => {
        // Four to a row, as the mockup has them, where details are three otherwise.
        expect(sheet()).toContain(`<dl class="ui-details ui-details-4">`)
        const details = (html: string) => text(html.slice(html.indexOf(`<dl class="ui-details ui-details-4">`), html.indexOf("</dl>")))
        expect(details(sheet())).toBe("ClientAl Noor TradingFigures as of16 November 2026From the Tax Authority's portalResponsible accountantKarim SaeedPrinted on21 November 2026")
        expect(details(sheet(STATEMENT, "ar"))).toBe("العميلAl Noor Tradingالأرقام حتى تاريخ١٦ نوفمبر ٢٠٢٦من بوابة مصلحة الضرائبالمحاسب المسؤولKarim Saeedتاريخ الطباعة٢١ نوفمبر ٢٠٢٦")
        // No one named where the client has no accountant.
        expect(details(sheet({ ...STATEMENT, accountant: null }))).toBe("ClientAl Noor TradingFigures as of16 November 2026From the Tax Authority's portalPrinted on21 November 2026")
        // Names kept whole, in their own direction.
        expect(sheet()).toContain("<dd><bdi>Al Noor Trading</bdi></dd>")
        expect(sheet()).toContain("<dd><bdi>Karim Saeed</bdi></dd>")
    })

    it("four facts: what's owed, what's paid with its share, how many are open, and how many are late", () => {
        const share = paidShare(POSITION.totals.paid, POSITION.totals.original)
        const facts = (html: string) => html.slice(html.indexOf(`<dl class="ui-doc-facts">`), html.indexOf("</dl>", html.indexOf(`<dl class="ui-doc-facts">`)))
        expect(facts(sheet())).toBe(`<dl class="ui-doc-facts">`
            + `<div class="ui-doc-fact"><dt>What the company owes</dt><dd>40,698.37 <span class="ui-doc-fact-unit">EGP</span></dd></div>`
            + `<div class="ui-doc-fact"><dt>Paid of the total claims</dt><dd>7,565.00 <span class="ui-doc-fact-unit">(${share.toLocaleString("en-GB", { style: "percent", maximumFractionDigits: 0 })})</span></dd></div>`
            + `<div class="ui-doc-fact"><dt>Open claims</dt><dd>7</dd></div>`
            + `<div class="ui-doc-fact" data-tone="problem"><dt>Late</dt><dd>5</dd></div>`)
        expect(text(facts(sheet(STATEMENT, "ar")))).toBe(`المستحق على الشركة٤٠٬٦٩٨٫٣٧ ج.مالمسدد من إجمالي المطالبات٧٬٥٦٥٫٠٠ (${share.toLocaleString("ar-EG", { style: "percent", maximumFractionDigits: 0 })})المطالبات المفتوحة٧متأخرة السداد٥`)
        // As the client's page rounds it: never 100% while something is left to pay.
        const nearly = summarise([claim("8", TRADE, 1000, 999.99, "2026-12-31")], TODAY, AS_OF)
        expect(facts(sheet({ ...STATEMENT, position: nearly }))).toContain(`<dd>999.99 <span class="ui-doc-fact-unit">(99%)</span></dd>`)
        // Nothing late: the count isn't in the Problem colour.
        const none = summarise([claim("5", HEALTH, 1600, 0, "2026-12-31")], TODAY, AS_OF)
        expect(facts(sheet({ ...STATEMENT, position: none }))).toContain(`<div class="ui-doc-fact"><dt>Late</dt><dd>0</dd></div>`)
    })

    it("its claims by item: the largest remaining first, each headed by its full name and how many, the latest last day to pay first", () => {
        const html = sheet()
        expect(table(html)).toContain(`<caption>Open claims by item</caption><thead><tr><th scope="col">Claim</th><th scope="col">Last day to pay</th><th scope="col" class="ui-end">Original</th><th scope="col" class="ui-end">Paid</th><th scope="col" class="ui-end">Remaining</th><th scope="col">Status</th></tr></thead>`)
        expect(rows(html)).toEqual([
            [`${VAT}3 claims`],
            ["000118000001September\u00a02026", "31 Oct 2026", "7,200.00", "0.00", "7,200.00", "Late"],
            ["000118000002February\u00a02025", "31 Mar 2025", "9,850.00", "0.00", "9,850.00", "Late"],
            ["000118000003January\u00a02025", "28 Feb 2025", "12,400.00", "4,000.00", "8,400.00", "LatePartly paid"],
            ["Total for the item", "29,450.00", "4,000.00", "25,450.00", ""],
            [`${INCOME}1 claim`],
            ["000118000004Year\u00a02025", "30 Apr 2026", "15,300.00", "3,365.00", "11,935.00", "LatePartly paid"],
            ["Total for the item", "15,300.00", "3,365.00", "11,935.00", ""],
            [`${HEALTH}2 claims`],
            ["0001180000051\u00a0Jul\u00a02026 to 30\u00a0Sept\u00a02026", "31 Dec 2026", "1,600.00", "0.00", "1,600.00", "Not due yet"],
            ["0001180000061\u00a0Apr\u00a02026 to 30\u00a0Jun\u00a02026", "31 Jul 2026", "1,413.37", "0.00", "1,413.37", "Late"],
            ["Total for the item", "3,013.37", "0.00", "3,013.37", ""],
            [`${TRADE}1 claim`],
            ["000118000007", "15 Dec 2026", "500.00", "200.00", "300.00", "Partly paid"],
            ["Total for the item", "500.00", "200.00", "300.00", ""],
        ])
        // Each item is a part of the table of its own, headed by its row.
        expect(table(html).match(/<tbody>/g)).toHaveLength(4)
        expect(table(html)).toContain(`<tr class="ui-doc-group-row"><th scope="rowgroup" colSpan="6"><span class="ui-doc-group-name"><bdi>${VAT}</bdi><span class="ui-doc-group-count">3 claims</span></span></th></tr>`)
        // The number in Latin digits, left to right, with its period under it.
        expect(table(html)).toContain(`<td><bdi dir="ltr" class="ui-doc-cell-title">000118000003</bdi><span class="ui-doc-cell-detail">January\u00a02025</span></td>`)
        expect(table(html)).toContain(`<td><bdi dir="ltr" class="ui-doc-cell-title">000118000007</bdi></td>`)
        // Each status for its colour; the remaining amount stands out.
        expect(table(html)).toContain(`<td><span class="ui-doc-status" data-status="late">Late</span><span class="ui-doc-status" data-status="partly_paid">Partly paid</span></td>`)
        expect(table(html)).toContain(`<td><span class="ui-doc-status" data-status="not_due">Not due yet</span></td>`)
        expect(table(html)).toContain(`<td class="ui-end ui-doc-remaining">8,400.00</td>`)
        expect(table(html)).toContain(`<tr class="ui-doc-item-total"><th scope="row" colSpan="2">Total for the item</th>`)
    })

    it("its foot: how many claims, and what they come to in all", () => {
        const foot = (html: string) => table(html).slice(table(html).indexOf("<tfoot>"))
        expect(foot(sheet())).toBe(`<tfoot><tr class="ui-doc-grand-total"><th scope="row" colSpan="2">Total, 7 claims</th><td class="ui-end">48,263.37</td><td class="ui-end">7,565.00</td><td class="ui-end">40,698.37</td><td></td></tr></tfoot>`)
        expect(text(foot(sheet(STATEMENT, "ar")))).toBe("الإجمالي، ٧ مطالبات٤٨٬٢٦٣٫٣٧٧٬٥٦٥٫٠٠٤٠٬٦٩٨٫٣٧")
    })

    it("in Arabic, its words and digits", () => {
        expect(rows(sheet(STATEMENT, "ar")).slice(0, 5)).toEqual([
            [`${VAT}٣ مطالبات`],
            ["000118000001سبتمبر\u00a0٢٠٢٦", "٣١ أكتوبر ٢٠٢٦", "٧٬٢٠٠٫٠٠", "٠٫٠٠", "٧٬٢٠٠٫٠٠", "متأخرة"],
            ["000118000002فبراير\u00a0٢٠٢٥", "٣١ مارس ٢٠٢٥", "٩٬٨٥٠٫٠٠", "٠٫٠٠", "٩٬٨٥٠٫٠٠", "متأخرة"],
            ["000118000003يناير\u00a0٢٠٢٥", "٢٨ فبراير ٢٠٢٥", "١٢٬٤٠٠٫٠٠", "٤٬٠٠٠٫٠٠", "٨٬٤٠٠٫٠٠", "متأخرةمسددة جزئيًا"],
            ["إجمالي البند", "٢٩٬٤٥٠٫٠٠", "٤٬٠٠٠٫٠٠", "٢٥٬٤٥٠٫٠٠", ""],
        ])
        expect(rows(sheet(STATEMENT, "ar"))[5]).toEqual([`${INCOME}مطالبة واحدة`])
        expect(rows(sheet(STATEMENT, "ar"))[6][0]).toBe("000118000004سنة\u00a0٢٠٢٥")
        expect(rows(sheet(STATEMENT, "ar"))[8]).toEqual([`${HEALTH}مطالبتان`])
        expect(rows(sheet(STATEMENT, "ar"))[9]).toEqual(["000118000005من ١\u00a0يوليو\u00a0٢٠٢٦ إلى ٣٠\u00a0سبتمبر\u00a0٢٠٢٦", "٣١ ديسمبر ٢٠٢٦", "١٬٦٠٠٫٠٠", "٠٫٠٠", "١٬٦٠٠٫٠٠", "لم يحن موعد سدادها"])
    })

    it("on phones, each claim is a block of lines, under its item, with its item's total, and the total in all", () => {
        const cards = (html: string) => html.slice(html.indexOf(`<div class="ui-doc-cards-groups">`))
        const html = cards(sheet())
        // In the table's order: the items as there, each item's claims the latest last day to pay first.
        expect([...html.matchAll(/<li class="ui-doc-card"><span class="ui-doc-card-head"><bdi dir="ltr">(\d+)<\/bdi>/g)].map(m => m[1])).toEqual(["000118000001", "000118000002", "000118000003", "000118000004", "000118000005", "000118000006", "000118000007"])
        expect(html).toContain(`<section class="ui-doc-cards-group"><p class="ui-doc-cards-group-head"><bdi>${VAT}</bdi><span class="ui-doc-group-count">3 claims</span></p><ul class="ui-doc-cards" aria-label="${VAT}">`)
        expect(html).toContain(`<li class="ui-doc-card"><span class="ui-doc-card-head"><bdi dir="ltr">000118000003</bdi><bdi class="ui-doc-amount">8,400.00</bdi></span><span class="ui-doc-card-detail">January\u00a02025, last day to pay 28\u00a0Feb\u00a02025</span><span class="ui-doc-card-detail">Original 12,400.00, paid 4,000.00</span><span class="ui-doc-card-status" data-status="late"><span class="ui-doc-status-word">Late</span>, partly paid</span></li>`)
        // With no period, its last day to pay alone; paid in part and not due, Partly paid alone.
        expect(html).toContain(`<span class="ui-doc-card-detail">Last day to pay 15\u00a0Dec\u00a02026</span><span class="ui-doc-card-detail">Original 500.00, paid 200.00</span><span class="ui-doc-card-status" data-status="partly_paid"><span class="ui-doc-status-word">Partly paid</span></span>`)
        expect(html).toContain(`<span class="ui-doc-card-status" data-status="not_due"><span class="ui-doc-status-word">Not due yet</span></span>`)
        expect(html).toContain(`<p class="ui-doc-cards-item-total"><span>Total for the item</span><bdi class="ui-doc-amount">25,450.00</bdi></p></section>`)
        expect(html).toContain(`<div class="ui-doc-cards-foot"><p class="ui-doc-cards-total"><span>Total, 7 claims</span><bdi class="ui-doc-amount">40,698.37</bdi></p><p class="ui-doc-card-detail">Original 48,263.37, paid 7,565.00</p></div>`)
        expect(cards(sheet(STATEMENT, "ar"))).toContain(`<span class="ui-doc-card-status" data-status="late"><span class="ui-doc-status-word">متأخرة</span>، مسددة جزئيًا</span>`)
        expect(cards(sheet(STATEMENT, "ar"))).toContain(`<span class="ui-doc-card-detail">يناير\u00a0٢٠٢٥، آخر موعد للسداد ٢٨\u00a0فبراير\u00a0٢٠٢٥</span><span class="ui-doc-card-detail">القيمة ١٢٬٤٠٠٫٠٠، المسدد ٤٬٠٠٠٫٠٠</span>`)
    })

    it("its note, and the signature as System settings has it", () => {
        const foot = (html: string) => html.slice(html.indexOf(`<footer class="ui-doc-foot">`), html.indexOf("</footer>") + 9)
        expect(foot(sheet())).toBe(`<footer class="ui-doc-foot"><p>${esc(en.tax_statement_note.replace("{date}", "16 November 2026"))}</p><p class="ui-doc-signature"><span>Powered by</span> <span translate="no">Nizmo</span></p></footer>`)
        expect(foot(sheet({ ...STATEMENT, signature: { show: true, name: "  " } }))).toContain(`<span translate="no">${DEFAULT_POWERED_BY_NAME}</span>`)
        expect(foot(sheet({ ...STATEMENT, signature: { show: true, name: "Nizmo Cloud" } }))).toContain(`<span translate="no">Nizmo Cloud</span>`)
        expect(foot(sheet({ ...STATEMENT, signature: { show: false, name: "Nizmo" } }))).toBe(`<footer class="ui-doc-foot"><p>${esc(en.tax_statement_note.replace("{date}", "16 November 2026"))}</p></footer>`)
        expect(text(foot(sheet(STATEMENT, "ar")))).toBe(ar.tax_statement_note.replace("{date}", "١٦ نوفمبر ٢٠٢٦") + "بدعم من Nizmo")
    })

    it("with nothing open in the file: the table's place says nothing was owed that day", () => {
        const html = sheet({ ...STATEMENT, position: summarise([], TODAY, AS_OF) })
        expect(html).not.toContain("<table")
        expect(html).not.toContain("ui-doc-cards")
        expect(html).toContain(`<p class="ui-doc-empty">Nothing was owed on the portal on 16 November 2026.</p>`)
        expect(html).toContain(`<div class="ui-doc-fact"><dt>Open claims</dt><dd>0</dd></div>`)
    })

    it("is a document: the sheet alone is printed", () => {
        expect(sheet()).toMatch(/^<article class="ui-panel ui-doc print-document">/)
    })
})

describe("Download the statement, on the client's own page", () => {
    const home = (position: PortalTaxPosition, accountant: { name: string; whatsappNumber: string | null } | null, locale: "en" | "ar" = "en") => {
        state.locale = locale
        return renderToStaticMarkup(h(PortalHome, { client: "Al Noor Trading", person: "Mona Adel", position, accountant, messages: NIZMO_MESSAGES }))
    }
    const actions = (html: string) => html.slice(html.indexOf(`<div class="ui-page-actions">`), html.indexOf("</header>"))
    const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const link = (words: typeof en) => new RegExp(`<a class="ui-btn ui-btn-secondary" href="/portal/statement" target="_blank" rel="noopener noreferrer"><svg[^>]*>[\\s\\S]*?</svg>${re(esc(words.tax_statement_download))}<span class="ui-visually-hidden"> ${re(esc(words.ui_opens_new_tab))}</span></a>`)

    it("beside Contact the accountant, opening the statement in a new tab, which it says to screen readers", () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = actions(home(POSITION, { name: "Karim Saeed", whatsappNumber: "+201001234567" }, locale))
            expect(html, locale).toMatch(new RegExp(`^<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary" aria-haspopup="dialog">[\\s\\S]*?${re(esc(words.portal_contact_accountant))}</button>${link(words).source}</div>$`))
        }
    })

    it("alone, where the client has no one to write to, and with nothing open in the file", () => {
        expect(actions(home(POSITION, null))).toMatch(new RegExp(`^<div class="ui-page-actions">${link(en).source}</div>$`))
        expect(actions(home(summarise([], TODAY, AS_OF), null))).toMatch(link(en))
    })

    it("not before the first upload", () => {
        expect(home(summarise([], TODAY, null), null)).not.toContain("/portal/statement")
        expect(home(summarise([], TODAY, null), { name: "Karim Saeed", whatsappNumber: "+201001234567" })).not.toContain("/portal/statement")
    })
})

describe("its words", () => {
    it("in both languages", () => {
        expect({
            tax_statement_title: en.tax_statement_title,
            tax_statement_download: en.tax_statement_download,
            tax_statement_file: en.tax_statement_file,
            tax_statement_as_of: en.tax_statement_as_of,
            tax_statement_from_portal: en.tax_statement_from_portal,
            tax_statement_accountant: en.tax_statement_accountant,
            tax_statement_printed_on: en.tax_statement_printed_on,
            tax_statement_paid: en.tax_statement_paid,
            tax_statement_late: en.tax_statement_late,
            tax_statement_claims: en.tax_statement_claims,
            tax_statement_col_claim: en.tax_statement_col_claim,
            tax_statement_status_late: en.tax_statement_status_late,
            tax_statement_status_partly_paid: en.tax_statement_status_partly_paid,
            tax_statement_status_not_due: en.tax_statement_status_not_due,
            tax_statement_card_late_partly: en.tax_statement_card_late_partly,
            tax_statement_item_total: en.tax_statement_item_total,
            tax_statement_card_amounts: en.tax_statement_card_amounts,
            tax_statement_note: en.tax_statement_note,
        }).toEqual({
            tax_statement_title: "Tax position statement",
            tax_statement_download: "Download the statement",
            tax_statement_file: "{client}, tax position statement, {date}",
            tax_statement_as_of: "Figures as of",
            tax_statement_from_portal: "From the Tax Authority's portal",
            tax_statement_accountant: "Responsible accountant",
            tax_statement_printed_on: "Printed on",
            tax_statement_paid: "Paid of the total claims",
            tax_statement_late: "Late",
            tax_statement_claims: "Open claims by item",
            tax_statement_col_claim: "Claim",
            tax_statement_status_late: "Late",
            tax_statement_status_partly_paid: "Partly paid",
            tax_statement_status_not_due: "Not due yet",
            tax_statement_card_late_partly: "{late}, partly paid",
            tax_statement_item_total: "Total for the item",
            tax_statement_card_amounts: "Original {original}, paid {paid}",
            tax_statement_note: "Amounts are in Egyptian pounds, as they were on the Tax Authority's portal on {date}, and penalties for paying late aren't counted. Late means the last day to pay has passed.",
        })
        expect({
            tax_statement_title: ar.tax_statement_title,
            tax_statement_download: ar.tax_statement_download,
            tax_statement_file: ar.tax_statement_file,
            tax_statement_as_of: ar.tax_statement_as_of,
            tax_statement_from_portal: ar.tax_statement_from_portal,
            tax_statement_accountant: ar.tax_statement_accountant,
            tax_statement_printed_on: ar.tax_statement_printed_on,
            tax_statement_paid: ar.tax_statement_paid,
            tax_statement_late: ar.tax_statement_late,
            tax_statement_claims: ar.tax_statement_claims,
            tax_statement_col_claim: ar.tax_statement_col_claim,
            tax_statement_status_late: ar.tax_statement_status_late,
            tax_statement_status_partly_paid: ar.tax_statement_status_partly_paid,
            tax_statement_status_not_due: ar.tax_statement_status_not_due,
            tax_statement_card_late_partly: ar.tax_statement_card_late_partly,
            tax_statement_item_total: ar.tax_statement_item_total,
            tax_statement_card_amounts: ar.tax_statement_card_amounts,
            tax_statement_note: ar.tax_statement_note,
        }).toEqual({
            tax_statement_title: "كشف الموقف الضريبي",
            tax_statement_download: "تحميل الكشف",
            tax_statement_file: "{client}، كشف الموقف الضريبي، {date}",
            tax_statement_as_of: "الأرقام حتى تاريخ",
            tax_statement_from_portal: "من بوابة مصلحة الضرائب",
            tax_statement_accountant: "المحاسب المسؤول",
            tax_statement_printed_on: "تاريخ الطباعة",
            tax_statement_paid: "المسدد من إجمالي المطالبات",
            tax_statement_late: "متأخرة السداد",
            tax_statement_claims: "المطالبات المفتوحة حسب البند",
            tax_statement_col_claim: "المطالبة",
            tax_statement_status_late: "متأخرة",
            tax_statement_status_partly_paid: "مسددة جزئيًا",
            tax_statement_status_not_due: "لم يحن موعد سدادها",
            tax_statement_card_late_partly: "{late}، مسددة جزئيًا",
            tax_statement_item_total: "إجمالي البند",
            tax_statement_card_amounts: "القيمة {original}، المسدد {paid}",
            tax_statement_note: "المبالغ بالجنيه المصري كما هي على بوابة مصلحة الضرائب يوم {date}، وغرامات التأخير غير محسوبة. «متأخرة» تعني أن آخر موعد للسداد قد مر.",
        })
    })
})

describe("how it's drawn", () => {
    it("four facts in a box, a rule around them and between them, two to a row on phones", () => {
        // As the mockup has them: the first two wider, so their labels fit.
        expect(rule(".ui-doc-facts")).toMatch(/grid-template-columns: minmax\(0, 1\.3fr\) minmax\(0, 1\.2fr\) minmax\(0, 1fr\) minmax\(0, 1fr\)/)
        expect(rule(".ui-doc-facts")).toMatch(/border: 1px solid var\(--rule\)/)
        expect(rule(".ui-doc-fact")).toMatch(/border-inline-end: 1px solid var\(--rule\)/)
        expect(rule(".ui-doc-fact:last-child")).toMatch(/border-inline-end: 0/)
        expect(rule(".ui-doc-fact dt")).toMatch(/font-size: var\(--text-sm\)[\s\S]*color: var\(--muted\)/)
        expect(rule(".ui-doc-fact dd")).toMatch(/font-size: var\(--text-lg\)[\s\S]*font-weight: 600/)
        expect(rule('.ui-doc-fact[data-tone="problem"] dd')).toMatch(/color: var\(--problem-text\)/)
        expect(inMedia(PHONE, ".ui-doc-facts")).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    })

    it("its details four to a row, two on phones, whatever the rule for details in general", () => {
        expect(rule(".ui-details.ui-details-4")).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
        expect(inMedia(PHONE, ".ui-details.ui-details-4")).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    })

    it("an item's heading row and its total in weight 600, the count in --muted, the foot in --text-lg under a 2px rule", () => {
        expect(rule(".ui-doc-group-row th")).toMatch(/font-weight: 600/)
        expect(rule(".ui-doc-group-count")).toMatch(/font-weight: 400[\s\S]*color: var\(--muted\)/)
        expect(rule(".ui-doc-item-total th,\n.ui-doc-item-total td")).toMatch(/font-weight: 600/)
        expect(rule(".ui-doc-table .ui-doc-remaining")).toMatch(/font-weight: 500/)
        expect(rule(".ui-doc-table .ui-doc-grand-total th,\n.ui-doc-table .ui-doc-grand-total td")).toMatch(/border-top: 2px solid var\(--ink\)[\s\S]*font-size: var\(--text-lg\)/)
    })

    it("Late in weight 600 and the Problem colour, Not due yet in --muted", () => {
        expect(rule('.ui-doc-status[data-status="late"],\n.ui-doc-card-status[data-status="late"] .ui-doc-status-word')).toMatch(/font-weight: 600[\s\S]*color: var\(--problem-text\)/)
        expect(rule('.ui-doc-status[data-status="not_due"],\n.ui-doc-card-status[data-status="not_due"]')).toMatch(/color: var\(--muted\)/)
    })

    it("the cards only on phones' screens, the table everywhere else", () => {
        expect(rule(".ui-doc-cards-groups")).toMatch(/display: none/)
        expect(inMedia(PHONE, ".ui-doc-cards-groups")).toMatch(/display: block/)
    })

    it("printed, an item's heading row stays with its first claim", () => {
        expect(inMedia(PRINT, ".ui-doc-group-row")).toMatch(/break-after: avoid/)
    })

    it("its foot over a rule in --text-sm and --muted, the signature at its end in --text-xs", () => {
        expect(rule(".ui-doc-foot")).toMatch(/border-top: 1px solid var\(--rule\)[\s\S]*font-size: var\(--text-sm\)[\s\S]*color: var\(--muted\)/)
        expect(rule(".ui-doc-signature")).toMatch(/align-self: flex-end[\s\S]*font-size: var\(--text-xs\)/)
    })

    it("in tokens and logical properties", () => {
        const raw = readFileSync("components/ui/ui.css", "utf8")
        const start = raw.indexOf("/* ── Tax position statement (§5.5) ── */")
        expect(start).toBeGreaterThan(0)
        const block = stripComments(raw.slice(start, raw.indexOf("/* ──", start + 10)))
        expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i)
        expect(block).not.toMatch(/\b(left|right)\b/)
        expect(block).not.toMatch(/margin-(top|bottom)|padding-(top|bottom)/)
    })
})
