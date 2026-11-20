import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"
import { summarise, claimPeriod, latestDueFirst, toggledItem, type PortalTaxPosition } from "./portal-tax"
import { daysLate, type TaxClaimRow } from "./tax-claims"

/**
 * The claims by item on the client's tax position page (CLIENT_PORTAL_PLAN.md
 * §6, §12 step 8d; DESIGN.md §5.5, A client's tax position; PR 339), as the
 * owner's mockup draws them: a table on computers and cards on phones, each
 * item opening to its claims, with a total row. Ask about this claim comes
 * with step 9.
 */

const state = { locale: "en" as "en" | "ar" }

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const { PortalHome } = await import("@/components/portal/PortalHome")
const { formatDay } = await import("@/components/records/types")

const TODAY = "2026-11-19"
const AS_OF = "2026-11-17"
const claim = (claimNumber: string, item: string, original: number, paid: number, dueDate: string, periodStart: string | null, periodEnd: string | null): TaxClaimRow => ({
    id: claimNumber, claimNumber, item, taxType: null, registrationType: null,
    originalAmount: original, paidAmount: paid, remainingAmount: Math.round((original - paid) * 100) / 100,
    currency: "جنيه مصري", status: null, periodStart, periodEnd, dueDate, daysLate: daysLate(dueDate, TODAY),
})
/** Made-up claims: three items, their periods a whole year, a whole month, part of one, and none; read the oldest due first. */
const CLAIMS = [
    claim("000110000002", "إقرار ضريبة الدخل", 500, 0, "2025-04-30", "2024-01-01", "2024-12-31"),
    claim("000110000001", "إقرار ضريبة الدخل", 1000, 0, "2026-04-30", "2025-01-01", "2025-12-31"),
    claim("000220000001", "إقرار القيمة المضافة", 400.5, 100.25, "2025-12-15", "2025-11-01", "2025-11-30"),
    claim("000330000001", "مساهمة تكافلية لصندوق أسر الشهداء", 9.45, 0, "2027-01-15", "2025-03-15", "2025-06-14"),
    claim("000330000002", "مساهمة تكافلية لصندوق أسر الشهداء", 16.3, 0, "2026-12-31", null, null),
]
const POSITION = summarise(CLAIMS, TODAY, AS_OF)

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const render = (position: PortalTaxPosition = POSITION, locale: "en" | "ar" = "en") => {
    state.locale = locale
    return renderToStaticMarkup(h(PortalHome, { client: "Nile Trading", position }))
}
// Spaces collapsed, the non-breaking ones kept.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[ \n\t]+/g, " ").trim()
const between = (html: string, from: string, to: string) => {
    const start = html.indexOf(from)
    expect([from, start >= 0]).toEqual([from, true])
    const end = html.indexOf(to, start)
    return html.slice(start, end < 0 ? undefined : end + to.length)
}
const table = (html: string) => between(html, '<table class="ui-claims-table">', "</table>")
const phoneCards = (html: string) => between(html, '<div class="ui-claims-phone">', "</section>")
/** The text of each <tag>…</tag> in a part of the page, cells by their own text. */
const all = (part: string, re: RegExp) => [...part.matchAll(re)]
const rowsOf = (part: string) => all(part, /<tr[^>]*>(.*?)<\/tr>/g).map(m => all(m[1], /<t[hd][^>]*>(.*?)<\/t[hd]>/g).map(c => text(c[1])))
const nbsp = (s: string) => s.replace(/ /g, "\u00a0")
/** A day as the page shows it, on one line. */
const day = (d: string, locale: "en" | "ar" = "en") => nbsp(formatDay(d, locale))

const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
function rule(selector: string): string {
    const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"))
    expect([selector, at >= 0]).toEqual([selector, true])
    const open = css.indexOf("{", at + 1)
    return css.slice(open + 1, css.indexOf("}", open))
}
function phone(): string {
    const parts: string[] = []
    const head = /@media (screen and )?\(max-width: 767px\) \{/g
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
const phoneRule = (selector: string) => {
    const body = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(phone())?.[1]
    expect([selector, body !== undefined]).toEqual([selector, true])
    return body ?? ""
}

beforeEach(() => { state.locale = "en" })

describe("where it is", () => {
    it("a card titled Claims, its hint, after the two cards of bars and before the note", () => {
        const html = render()
        const columns = html.indexOf('<div class="ui-columns">'), claims = html.indexOf('class="ui-panel ui-portal-claims"'), note = html.indexOf('class="ui-portal-note"')
        expect(columns).toBeGreaterThan(0)
        expect(claims).toBeGreaterThan(columns)
        expect(note).toBeGreaterThan(claims)
        expect(html).toMatch(/<section class="ui-panel ui-portal-claims" aria-labelledby="([^"]+)"><div class="ui-portal-claims-head"><h2 id="\1" class="ui-card-title">Claims<\/h2><p class="ui-portal-claims-hint">Select an item to see its claims<\/p><\/div>/)
        expect(render(POSITION, "ar")).toContain('class="ui-card-title">المطالبات</h2><p class="ui-portal-claims-hint">الضغط على أي بند يعرض مطالباته</p>')
    })

    it("isn't there before the first upload, or with nothing open", () => {
        expect(render(summarise([], TODAY, null))).not.toContain("ui-portal-claims")
        expect(render(summarise([], TODAY, AS_OF))).not.toContain("ui-portal-claims")
    })
})

describe("on computers, a table", () => {
    it("named for screen readers, its head's seven columns in order", () => {
        const part = table(render())
        expect(part).toContain('<caption class="ui-visually-hidden">Claims</caption>')
        expect(all(between(part, "<thead>", "</thead>"), /<th scope="col">(.*?)<\/th>/g).map(m => m[1])).toEqual(["Item", "Claims", "Original", "Paid", "Remaining", "Earliest due date", "Status"])
        expect(all(between(table(render(POSITION, "ar")), "<thead>", "</thead>"), /<th scope="col">(.*?)<\/th>/g).map(m => m[1])).toEqual(["البند", "المطالبات", "القيمة", "المسدد", "المتبقي", "أقدم موعد سداد", "الحالة"])
    })

    it("an item a row, the largest remaining first: how many claims, the original, paid and remaining amounts, the earliest last day to pay and its claims' badges", () => {
        const items = all(table(render()), /<tbody class="ui-claims-item">(.*?)<\/tbody>/g).map(m => rowsOf(m[1])[0])
        expect(items).toEqual([
            ["إقرار ضريبة الدخل", "2", "1,500.00", "0.00", "1,500.00", day("2025-04-30"), "Late"],
            ["إقرار القيمة المضافة", "1", "400.50", "100.25", "300.25", day("2025-12-15"), "Partly paid Late"],
            ["مساهمة تكافلية لصندوق أسر الشهداء", "2", "25.75", "0.00", "25.75", day("2026-12-31"), ""],
        ])
        // What remains stands out.
        expect(table(render())).toContain('<td class="ui-num ui-claims-remaining">1,500.00</td>')
        // In Arabic, with Arabic digits; the items in full, never their short names.
        const ar1 = all(table(render(POSITION, "ar")), /<tbody class="ui-claims-item">(.*?)<\/tbody>/g).map(m => rowsOf(m[1])[0])
        expect(ar1[0]).toEqual(["إقرار ضريبة الدخل", "٢", "١٬٥٠٠٫٠٠", "٠٫٠٠", "١٬٥٠٠٫٠٠", day("2025-04-30", "ar"), "متأخر"])
        expect(ar1[2][0]).toBe("مساهمة تكافلية لصندوق أسر الشهداء")
        expect(ar1[1][6]).toBe("مسدد جزئيًا متأخر")
    })

    it("each item's row is a button saying whether it's open and what it opens; the largest is open at first, the others closed", () => {
        const part = table(render())
        const buttons = all(part, /<button type="button" class="ui-claims-toggle" aria-expanded="(true|false)" aria-controls="([^"]+)">/g)
        expect(buttons.map(m => m[1])).toEqual(["true", "false", "false"])
        for (const [i, m] of buttons.entries()) {
            const claims = new RegExp(`<tbody id="${m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" class="ui-claims-of"( hidden="")?>`).exec(part)
            expect([i, claims !== null, claims?.[1] === undefined]).toEqual([i, true, i === 0])
        }
        // The button is the row's first cell, its header, with a caret: down while open, to the end side while closed (turned in Arabic).
        expect(part).toMatch(/<tr><th scope="row"><button type="button" class="ui-claims-toggle" aria-expanded="true"[^>]*><svg[^>]*class="ui-icon ui-claims-caret"/)
        expect(part).toMatch(/aria-expanded="false"[^>]*><svg[^>]*class="ui-icon ui-flip ui-claims-caret"/)
    })

    it("a claim's row: its number left to right in Latin digits above its period, then its amounts, last day to pay and badges; the latest last day to pay first", () => {
        const part = table(render())
        const first = between(part, '<tbody id="', "</tbody>")
        expect(first).toContain('<th scope="row"><span class="ui-claim-number" dir="ltr">000110000001</span><span class="ui-claim-period">Year\u00a02025</span></th>')
        expect(rowsOf(first)).toEqual([
            ["000110000001 Year\u00a02025", "", "1,000.00", "0.00", "1,000.00", day("2026-04-30"), "Late"],
            ["000110000002 Year\u00a02024", "", "500.00", "0.00", "500.00", day("2025-04-30"), "Late"],
        ])
        // The remaining amount stands out, as the item's does.
        expect(first).toContain('<td class="ui-num ui-claims-remaining">1,000.00</td>')
        // In Arabic the number keeps its Latin digits.
        expect(table(render(POSITION, "ar"))).toContain('<span class="ui-claim-number" dir="ltr">000110000001</span><span class="ui-claim-period">سنة\u00a0٢٠٢٥</span>')
    })

    it("a claim's period as the portal means it: a whole month, part of one, or none", () => {
        const part = table(render())
        expect(part).toContain('<span class="ui-claim-number" dir="ltr">000220000001</span><span class="ui-claim-period">November\u00a02025</span>')
        expect(part).toContain(`<span class="ui-claim-number" dir="ltr">000330000001</span><span class="ui-claim-period">${day("2025-03-15")} to ${day("2025-06-14")}</span>`)
        expect(part).toContain('<span class="ui-claim-number" dir="ltr">000330000002</span></th>')
        expect(table(render(POSITION, "ar"))).toContain('<span class="ui-claim-period">نوفمبر\u00a0٢٠٢٥</span>')
    })

    it("a total row at its foot: how many claims and the amounts in all", () => {
        const foot = between(table(render()), "<tfoot>", "</tfoot>")
        expect(rowsOf(foot)).toEqual([["Total", "5", "1,926.25", "100.25", "1,826.00", "", ""]])
        expect(rowsOf(between(table(render(POSITION, "ar")), "<tfoot>", "</tfoot>"))[0].slice(0, 2)).toEqual(["الإجمالي", "٥"])
    })
})

describe("on phones, cards", () => {
    it("each item a card that opens: its name, how many claims and what remains with its currency, then its badges", () => {
        const part = phoneCards(render())
        expect(part).toContain('<ul class="ui-claims-cards" aria-label="Claims">')
        const cards = all(part, /<button type="button" class="ui-claims-card" aria-expanded="(true|false)" aria-controls="([^"]+)">(.*?)<\/button>/g)
        expect(cards.map(m => [m[1], text(m[3])])).toEqual([
            ["true", "إقرار ضريبة الدخل 2 claims 1,500.00 EGP Late"],
            ["false", "إقرار القيمة المضافة 1 claim 300.25 EGP Partly paid Late"],
            ["false", "مساهمة تكافلية لصندوق أسر الشهداء 2 claims 25.75 EGP"],
        ])
        for (const [i, m] of cards.entries()) {
            const claims = new RegExp(`<ul id="${m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" class="ui-claims-card-claims" aria-label="[^"]+"( hidden="")?>`).exec(part)
            expect([i, claims !== null, claims?.[1] === undefined]).toEqual([i, true, i === 0])
        }
        expect(text(all(phoneCards(render(POSITION, "ar")), /<button type="button" class="ui-claims-card"[^>]*>(.*?)<\/button>/g)[0][1])).toBe(`إقرار ضريبة الدخل مطالبتان ١٬٥٠٠٫٠٠ ${ar.egp} متأخر`)
    })

    it("each claim a card: its number and badges, its period and last day to pay, then its three amounts under their labels", () => {
        const part = phoneCards(render())
        const first = all(part, /<li class="ui-claim-card">(.*?)<\/li>/g).map(m => m[1])
        expect(first[0]).toContain('<div class="ui-claim-card-top"><span class="ui-claim-number" dir="ltr">000110000001</span>')
        expect(text(first[0])).toBe(`000110000001 Late Year\u00a02025, last day to pay ${day("2026-04-30")} Original 1,000.00 Paid 0.00 Remaining 1,000.00`)
        expect(first[0]).toContain('<dl class="ui-claim-amounts"><div><dt>Original</dt><dd class="ui-num">1,000.00</dd></div><div><dt>Paid</dt><dd class="ui-num">0.00</dd></div><div class="ui-claim-amounts-remaining"><dt>Remaining</dt><dd class="ui-num">1,000.00</dd></div></dl>')
        // With no period, its last day to pay alone.
        expect(text(first[4])).toBe(`000330000002 Last day to pay ${day("2026-12-31")} Original 16.30 Paid 0.00 Remaining 16.30`)
        const firstAr = all(phoneCards(render(POSITION, "ar")), /<li class="ui-claim-card">(.*?)<\/li>/g).map(m => text(m[1]))
        expect(firstAr[0]).toContain(`سنة\u00a0٢٠٢٥، آخر موعد للسداد ${day("2026-04-30", "ar")}`)
        expect(firstAr[4]).toContain(`آخر موعد للسداد ${day("2026-12-31", "ar")}`)
    })

    it("the total: how many claims, then the three amounts in all", () => {
        const total = between(phoneCards(render()), '<div class="ui-claims-cards-total">', "</dl></div>")
        expect(text(total)).toBe("Total, 5 claims Original 1,926.25 Paid 100.25 Remaining 1,826.00")
        expect(text(between(phoneCards(render(POSITION, "ar")), '<div class="ui-claims-cards-total">', "</p>"))).toBe("الإجمالي، ٥ مطالبات")
    })

    it("the table's and the cards' ids are each their own", () => {
        const ids = all(render(), /aria-controls="([^"]+)"/g).map(m => m[1])
        expect(ids.length).toBe(6)
        expect(new Set(ids).size).toBe(6)
    })
})

describe("opening and closing", () => {
    it("an item opens and closes by itself, the others as they were", () => {
        const open = new Set(["a"])
        expect([...toggledItem(open, "b")].sort()).toEqual(["a", "b"])
        expect([...toggledItem(open, "a")]).toEqual([])
        // The set it was given is left as it was.
        expect([...open]).toEqual(["a"])
    })
})

describe("an item's claims", () => {
    it("the latest last day to pay first, claims due the same day in the order they were read", () => {
        const c = (claimNumber: string, dueDate: string) => claim(claimNumber, "x", 1, 0, dueDate, null, null)
        expect(latestDueFirst([c("a", "2024-01-31"), c("b", "2026-01-31"), c("c", "2025-01-31"), c("d", "2026-01-31")]).map(x => x.claimNumber)).toEqual(["b", "d", "c", "a"])
    })
})

describe("a claim's period", () => {
    it("a whole year, a whole month (February too), part of one, one day, or none", () => {
        expect(claimPeriod("2025-01-01", "2025-12-31")).toEqual({ kind: "year", year: 2025 })
        expect(claimPeriod("2025-11-01", "2025-11-30")).toEqual({ kind: "month", year: 2025, month: 11 })
        expect(claimPeriod("2024-02-01", "2024-02-29")).toEqual({ kind: "month", year: 2024, month: 2 })
        expect(claimPeriod("2025-02-01", "2025-02-28")).toEqual({ kind: "month", year: 2025, month: 2 })
        expect(claimPeriod("2024-02-01", "2024-02-28")).toEqual({ kind: "range", from: "2024-02-01", to: "2024-02-28" })
        expect(claimPeriod("2025-11-01", "2025-11-29")).toEqual({ kind: "range", from: "2025-11-01", to: "2025-11-29" })
        expect(claimPeriod("2025-01-01", "2026-12-31")).toEqual({ kind: "range", from: "2025-01-01", to: "2026-12-31" })
        expect(claimPeriod("2025-03-01", "2025-12-31")).toEqual({ kind: "range", from: "2025-03-01", to: "2025-12-31" })
        expect(claimPeriod("2025-01-01", "2025-11-30")).toEqual({ kind: "range", from: "2025-01-01", to: "2025-11-30" })
        expect(claimPeriod("2025-03-15", "2025-06-14")).toEqual({ kind: "range", from: "2025-03-15", to: "2025-06-14" })
        expect(claimPeriod("2025-03-15", "2025-03-15")).toEqual({ kind: "day", day: "2025-03-15" })
        expect(claimPeriod("2025-03-15", null)).toEqual({ kind: "day", day: "2025-03-15" })
        expect(claimPeriod(null, "2025-03-15")).toEqual({ kind: "day", day: "2025-03-15" })
        expect(claimPeriod(null, null)).toBeNull()
    })
})

describe("its look", () => {
    it("the card's head: its title and hint on one line, the hint in --text-xs and --muted; under it on phones", () => {
        expect(rule(".ui-portal-claims")).toMatch(/padding:\s*0;/)
        const head = rule(".ui-portal-claims-head")
        expect(head).toMatch(/display:\s*flex;/)
        expect(head).toMatch(/justify-content:\s*space-between;/)
        expect(head).toMatch(/border-block-end:\s*1px solid var\(--rule\);/)
        const hint = rule(".ui-portal-claims-hint")
        expect(hint).toMatch(/font-size:\s*var\(--text-xs\);/)
        expect(hint).toMatch(/color:\s*var\(--muted\);/)
        expect(phoneRule(".ui-portal-claims-head")).toMatch(/flex-direction:\s*column;/)
    })

    it("the table 940px at the least, scrolling in its card; its head on --page in --text-xs, weight 500, --muted", () => {
        expect(rule(".ui-claims-table")).toMatch(/min-width:\s*940px;/)
        const head = rule(".ui-claims-table thead th")
        expect(head).toMatch(/background:\s*var\(--page\);/)
        expect(head).toMatch(/font-size:\s*var\(--text-xs\);/)
        expect(head).toMatch(/font-weight:\s*500;/)
        expect(head).toMatch(/color:\s*var\(--muted\);/)
        // As tall as the mockup's: its head 12px above and below, an item's row and the total 16px.
        expect(head).toMatch(/padding-block:\s*var\(--space-3\);/)
        expect(rule(".ui-claims-item tr > *")).toMatch(/padding-block:\s*var\(--space-4\);/)
        expect(css.indexOf(".ui-claims-item tr > * {")).toBeGreaterThan(css.indexOf(".ui-claims-table th,"))
        expect(rule(".ui-claims-table tfoot > tr > *")).toMatch(/padding-block:\s*var\(--space-4\);/)
    })

    it("an item's name weight 600 in --ink, what remains weight 700; a claim's row on --page, set in under its item's name; the total on --page, weight 700", () => {
        expect(rule(".ui-claims-toggle")).toMatch(/font-weight:\s*600;/)
        expect(rule(".ui-claims-toggle")).toMatch(/color:\s*var\(--ink\);/)
        expect(rule(".ui-claims-item .ui-claims-remaining")).toMatch(/font-weight:\s*700;/)
        expect(rule(".ui-claims-of > tr > *")).toMatch(/background:\s*var\(--page\);/)
        // Set in past the caret: as specific as the first cells' padding, and after it, so it wins.
        expect(rule(".ui-claims-table .ui-claims-of th")).toMatch(/padding-inline-start:\s*calc\(var\(--space-6\) \+ var\(--space-6\)\);/)
        expect(css.indexOf(".ui-claims-table .ui-claims-of th {")).toBeGreaterThan(css.indexOf(".ui-claims-table tr > :first-child {"))
        expect(rule(".ui-claims-of .ui-claims-remaining")).toMatch(/font-weight:\s*600;/)
        const total = rule(".ui-claims-table tfoot > tr > *")
        expect(total).toMatch(/background:\s*var\(--page\);/)
        expect(total).toMatch(/font-weight:\s*700;/)
    })

    it("a claim's number left to right, its period in --text-xs and --muted under it", () => {
        expect(rule(".ui-claim-number")).toMatch(/unicode-bidi:\s*isolate;/)
        const period = rule(".ui-claim-period")
        expect(period).toMatch(/display:\s*block;/)
        expect(period).toMatch(/font-size:\s*var\(--text-xs\);/)
        expect(period).toMatch(/color:\s*var\(--muted\);/)
    })

    it("an item's row and card show where the pointer is, on --brand-tint over 150ms, only where there's a pointer; a card's focus ring inside its edge, which the card's panel would clip", () => {
        expect(rule(".ui-claims-item tr > *")).toMatch(/transition:\s*background-color 150ms ease-out;/)
        expect(rule(".ui-claims-card")).toMatch(/transition:\s*background-color 150ms ease-out;/)
        const hover = /@media \(hover: hover\) \{([^@]*)\}\s*\n/.exec(css.slice(css.indexOf(".ui-claims-card {")))?.[1] ?? ""
        expect(hover).toMatch(/\.ui-claims-item tr:hover > \*\s*\{\s*background:\s*var\(--brand-tint\);/)
        expect(hover).toMatch(/\.ui-claims-card:hover\s*\{\s*background:\s*var\(--brand-tint\);/)
        expect(rule(".ui-claims-card:focus-visible")).toMatch(/outline-offset:\s*-2px;/)
    })

    it("the cards only on phones, the table only on computers", () => {
        expect(rule(".ui-claims-phone")).toMatch(/display:\s*none;/)
        expect(phoneRule(".ui-claims-phone")).toMatch(/display:\s*block;/)
        expect(phoneRule(".ui-claims-scroll")).toMatch(/display:\s*none;/)
    })

    it("on phones an item's card is 64px high at the least; a claim's card on --page, set in under the name, its amounts in three columns", () => {
        expect(rule(".ui-claims-card")).toMatch(/min-height:\s*64px;/)
        expect(rule(".ui-claims-card")).toMatch(/width:\s*100%;/)
        const card = rule(".ui-claim-card")
        expect(card).toMatch(/background:\s*var\(--page\);/)
        expect(card).toMatch(/padding-inline-start:\s*calc\(/)
        expect(rule(".ui-claim-amounts")).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/)
        expect(rule(".ui-claims-cards-total")).toMatch(/background:\s*var\(--page\);/)
    })
})

describe("its words", () => {
    it("in both languages", () => {
        expect([en.portal_claims, ar.portal_claims]).toEqual(["Claims", "المطالبات"])
        expect([en.portal_claims_hint, ar.portal_claims_hint]).toEqual(["Select an item to see its claims", "الضغط على أي بند يعرض مطالباته"])
        expect([en.portal_claims_col_claims, ar.portal_claims_col_claims]).toEqual(["Claims", "المطالبات"])
        expect([en.portal_claims_col_earliest, ar.portal_claims_col_earliest]).toEqual(["Earliest due date", "أقدم موعد سداد"])
        expect([en.portal_claims_total, ar.portal_claims_total]).toEqual(["Total", "الإجمالي"])
        expect([en.portal_claims_total_count, ar.portal_claims_total_count]).toEqual(["Total, {claims}", "الإجمالي، {claims}"])
        expect([en.portal_claim_year, ar.portal_claim_year]).toEqual(["Year {year}", "سنة {year}"])
        expect([en.portal_claim_due, ar.portal_claim_due]).toEqual(["Last day to pay {date}", "آخر موعد للسداد {date}"])
        expect([en.portal_claim_period_due, ar.portal_claim_period_due]).toEqual(["{period}, last day to pay {date}", "{period}، آخر موعد للسداد {date}"])
        expect(esc(en.portal_claims_hint)).toBe(en.portal_claims_hint)
    })
})
