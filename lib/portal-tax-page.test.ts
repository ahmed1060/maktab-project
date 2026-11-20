import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"
import { summarise, type PortalTaxPosition } from "./portal-tax"
import { daysLate, type TaxClaimRow } from "./tax-claims"

/**
 * The top of the client's tax position page (CLIENT_PORTAL_PLAN.md §6, §12
 * step 8c; DESIGN.md §5.5, A client's tax position; PR 338): its header,
 * what's owed, the two cards of bars and the note, and the page before the
 * first upload and with nothing open. The claims by item come with 8d.
 */

const state = {
    locale: "en" as "en" | "ar",
    session: null as null | { user: Record<string, unknown> },
    read: [] as { companyId: string; clientId: string }[],
    position: null as null | PortalTaxPosition | Error,
}

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
vi.mock("@/lib/services/tax-claim.service", () => ({
    portalTaxPosition: async (account: { companyId: string; clientId: string }) => {
        state.read.push(account)
        if (state.position instanceof Error) throw state.position
        return state.position
    },
}))

const { PortalHome } = await import("@/components/portal/PortalHome")
const { SESSION_ENDED_PATH } = await import("./session-ended")

const TODAY = "2026-11-19"
const AS_OF = "2026-11-17"
const claim = (id: string, item: string, original: number, paid: number, dueDate: string): TaxClaimRow => ({
    id, claimNumber: `0${id}`, item, taxType: null, registrationType: null,
    originalAmount: original, paidAmount: paid, remainingAmount: Math.round((original - paid) * 100) / 100,
    currency: "جنيه مصري", status: null, periodStart: null, periodEnd: null, dueDate, daysLate: daysLate(dueDate, TODAY),
})
/** Made-up claims: two of one item (one spelled as the portal sometimes does), late from under 6 months to more than 2 years. */
const CLAIMS = [
    claim("1", "إقرار ضريبة الدخل", 1000, 0, "2025-06-30"),
    claim("2", "اقرار ضريبه الدخل", 200, 0, "2024-03-31"),
    claim("3", "إقرار القيمة المضافة", 400.5, 100.25, "2026-08-31"),
    claim("4", "مساهمة تكافلية لصندوق أسر الشهداء", 150, 110, "2026-12-31"),
]
const POSITION = summarise(CLAIMS, TODAY, AS_OF)

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const render = (position: PortalTaxPosition, locale: "en" | "ar" = "en") => {
    state.locale = locale
    return renderToStaticMarkup(h(PortalHome, { client: "Nile Trading", position }))
}
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
const percentAr = (n: number) => n.toLocaleString("ar-EG", { style: "percent", maximumFractionDigits: 0 })
const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))

/** The body of the rule whose selector is exactly this one, outside any media block. */
function rule(selector: string): string {
    const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"))
    expect([selector, at >= 0]).toEqual([selector, true])
    const open = css.indexOf("{", at + 1)
    return css.slice(open + 1, css.indexOf("}", open))
}
/** What's inside the phone's media blocks (up to 767px wide), all of them together. */
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

beforeEach(() => {
    state.locale = "en"
    state.session = null
    state.read = []
    state.position = null
})

describe("what the page is given", () => {
    it("the session's client's position, read with the session's company and client, never the address's", async () => {
        state.session = { user: { id: "acct-1", role: "CLIENT_ACCOUNT", companyId: "co-1", clientId: "client-1", clientName: "Nile Trading" } }
        state.position = POSITION
        const { default: PortalPage } = await import("@/app/(portal)/portal/page")
        const page = await PortalPage() as ReactElement<{ client: string; position: PortalTaxPosition }>
        expect(state.read).toEqual([{ companyId: "co-1", clientId: "client-1" }])
        expect(page.type).toBe(PortalHome)
        expect(page.props).toEqual({ client: "Nile Trading", position: POSITION })
        expect(readFileSync("app/(portal)/portal/page.tsx", "utf8")).not.toMatch(/params|searchParams/)
    })

    it("a client no longer there ends the session, and anything else that goes wrong is thrown", async () => {
        state.session = { user: { id: "acct-1", role: "CLIENT_ACCOUNT", companyId: "co-1", clientId: "client-1", clientName: "Nile Trading" } }
        const { default: PortalPage } = await import("@/app/(portal)/portal/page")
        state.position = new Error("CLIENT_NOT_FOUND")
        await expect(PortalPage()).rejects.toThrow(`REDIRECT ${SESSION_ENDED_PATH}`)
        state.position = new Error("connection lost")
        await expect(PortalPage()).rejects.toThrow("connection lost")
    })

    it("nothing is read for a session that isn't a client account's", async () => {
        const { default: PortalPage } = await import("@/app/(portal)/portal/page")
        await expect(PortalPage()).rejects.toThrow(`REDIRECT ${SESSION_ENDED_PATH}`)
        state.session = { user: { id: "u1", role: "ADMIN", companyId: "co-1" } }
        await expect(PortalPage()).rejects.toThrow("REDIRECT /dashboard")
        // A client account's session without its client is ended, not read.
        state.session = { user: { id: "acct-1", role: "CLIENT_ACCOUNT", companyId: "co-1", clientId: null } }
        await expect(PortalPage()).rejects.toThrow(`REDIRECT ${SESSION_ENDED_PATH}`)
        expect(state.read).toEqual([])
    })
})

describe("before the first upload", () => {
    const none = summarise([], TODAY, null)

    it("says the office hasn't added the tax position yet, under the header with no subtitle", () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = render(none, locale)
            expect(html, locale).toContain(`<p class="ui-page-overline">Nile Trading</p>`)
            expect(html, locale).toContain(`<h1 class="ui-page-title">${esc(words.tax_position)}</h1>`)
            expect(html, locale).not.toContain("ui-page-subtitle")
            expect(html, locale).toContain(`<p class="ui-empty-title">${esc(words.portal_tax_none)}</p><p class="ui-empty-detail">${esc(words.portal_tax_none_detail)}</p>`)
            expect(html, locale).not.toMatch(/ui-large-figure|ui-bars|ui-share|ui-portal-note/)
        }
        expect(en.portal_tax_none).toBe("The office hasn't added the tax position yet")
        expect(en.portal_tax_none_detail).toBe("It's shown here once it's added.")
        expect(ar.portal_tax_none).toBe("لم يُضِف المكتب الموقف الضريبي بعد")
        expect(ar.portal_tax_none_detail).toBe("يُعرض هنا عند إضافته.")
    })

    it("the line saying it comes soon is gone", () => {
        expect("portal_tax_soon" in en).toBe(false)
        expect("portal_tax_soon" in ar).toBe(false)
    })
})

describe("the header", () => {
    it("the client's name above Tax position, and where the figures come from and their day", () => {
        expect(render(POSITION)).toContain(`<p class="ui-page-subtitle">From the Tax Authority&#x27;s portal on 17 Nov 2026.</p>`)
        expect(render(POSITION, "ar")).toContain(`<p class="ui-page-subtitle">من بوابة مصلحة الضرائب بتاريخ ١٧ نوفمبر ٢٠٢٦.</p>`)
        expect(en.portal_tax_from).toBe("From the Tax Authority's portal on {date}.")
        expect(ar.portal_tax_from).toBe("من بوابة مصلحة الضرائب بتاريخ {date}.")
    })
})

describe("a file with nothing open in it", () => {
    const nothing = summarise([], TODAY, AS_OF)

    it("says nothing was owed on the portal that day, under the header and its subtitle, with no cards or note", () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = render(nothing, locale)
            expect(html, locale).toContain(`class="ui-page-subtitle"`)
            // The day kept on one line.
            const day = locale === "ar" ? "١٧\u00a0نوفمبر\u00a0٢٠٢٦" : "17\u00a0Nov\u00a02026"
            expect(text(html), locale).toContain(`${words.tax_no_open_claims}${words.tax_no_open_claims_detail.replace("{date}", day)}`)
            expect(html, locale).not.toMatch(/ui-large-figure|ui-bars|ui-share|ui-portal-note/)
        }
    })
})

describe("what's owed", () => {
    it("in a card: its label, then what remains as the page's one large figure, its currency after it", () => {
        const html = render(POSITION)
        expect(html).toContain(`<h2 class="ui-card-title">What&#x27;s owed</h2>`)
        expect(html).toContain(`<p class="ui-large-figure"><span class="ui-large-figure-value ui-num">1,540.25</span> <span class="ui-large-figure-unit">EGP</span></p>`)
        expect(render(POSITION, "ar")).toContain(`<p class="ui-large-figure"><span class="ui-large-figure-value ui-num">١٬٥٤٠٫٢٥</span> <span class="ui-large-figure-unit">${ar.egp}</span></p>`)
    })

    it("a Problem badge under it saying how many are late, or that all are where there's more than one", () => {
        const badge = (position: PortalTaxPosition, locale: "en" | "ar" = "en") =>
            /<span class="ui-badge ui-badge-problem">([^<]*)<\/span>/.exec(render(position, locale))?.[1]
        expect(badge(POSITION)).toBe("3 claims late")
        expect(badge(POSITION, "ar")).toBe("متأخرة: ٣ مطالبات")
        const allLate = summarise(CLAIMS.slice(0, 2), TODAY, AS_OF)
        expect(badge(allLate)).toBe("All open claims are late")
        expect(badge(allLate, "ar")).toBe("كل المطالبات المفتوحة متأخرة")
        // One late claim of one is how many, not all.
        expect(badge(summarise(CLAIMS.slice(0, 1), TODAY, AS_OF))).toBe("1 claim late")
        expect(badge(summarise(CLAIMS.slice(3), TODAY, AS_OF))).toBeUndefined()
        expect(render(summarise(CLAIMS.slice(3), TODAY, AS_OF))).not.toContain("ui-badge")
    })

    it("the badge is under the figure, and the share paid and the facts beside it", () => {
        const html = render(POSITION)
        expect(html).toMatch(/<div class="ui-portal-owed"><div class="ui-portal-owed-figure"><p class="ui-large-figure">.*?<\/p><p class="ui-portal-owed-late"><span class="ui-badge ui-badge-problem">.*?<\/span><\/p><\/div><div class="ui-portal-owed-paid"><div class="ui-share">.*?<\/div><dl class="ui-portal-facts">/)
    })

    it("how much of the open claims' original amounts is paid, rounded down to a whole percent", () => {
        // 210.25 of 1,750.50 is 12.01%.
        const html = render(POSITION)
        expect(html).toContain(`<p class="ui-share-line"><span>12% paid</span> <span class="ui-share-amounts ui-num">210.25 of 1,750.50</span></p>`)
        expect(html).toContain(`style="--share:12%"`)
        const arabic = render(POSITION, "ar")
        expect(arabic).toContain(`<span>تم سداد ${percentAr(0.12)}</span> <span class="ui-share-amounts ui-num">٢١٠٫٢٥ من ١٬٧٥٠٫٥٠</span>`)
    })

    it("never 100% while something is left to pay", () => {
        // 995 of 1,000 is 99.5%: 99% paid.
        const html = render(summarise([claim("9", "إقرار شهري", 1000, 995, "2026-12-31")], TODAY, AS_OF))
        expect(html).toContain("<span>99% paid</span>")
        expect(html).toContain(`style="--share:99%"`)
    })

    it("the share is worked out to the whole percent, a float a hair under it counting as it", async () => {
        const { paidShare } = await import("./portal-tax")
        expect(paidShare(29, 100)).toBe(0.29)
        expect(paidShare(57, 100)).toBe(0.57)
        expect(paidShare(210.25, 1750.5)).toBe(0.12)
        expect(paidShare(999.99, 1000)).toBe(0.99)
        expect(paidShare(1000, 1000)).toBe(1)
        expect(paidShare(0, 1000)).toBe(0)
        expect(paidShare(5, 0)).toBe(0)
    })

    it("three facts: open claims, paid, and the oldest delay in days, or None", () => {
        const facts = (html: string) => [...html.matchAll(/<div class="ui-portal-fact"><dt>([^<]*)<\/dt><dd class="ui-num">([^<]*)<\/dd><\/div>/g)].map(m => [m[1], m[2]])
        // The days kept with their number.
        expect(facts(render(POSITION))).toEqual([["Open claims", "4"], ["Paid", "210.25"], ["Oldest delay", "963\u00a0days"]])
        expect(facts(render(POSITION, "ar"))).toEqual([["مطالبات مفتوحة", "٤"], ["المسدد", "٢١٠٫٢٥"], ["أقدم تأخير", "٩٦٣\u00a0يومًا"]])
        const onTime = summarise(CLAIMS.slice(3), TODAY, AS_OF)
        expect(facts(render(onTime))[2]).toEqual(["Oldest delay", "None"])
        expect(facts(render(onTime, "ar"))[2]).toEqual(["أقدم تأخير", "لا يوجد"])
    })

    it("the share bar's words", () => {
        expect([en.portal_tax_share_paid, en.portal_tax_paid_of, en.portal_tax_all_late, en.portal_tax_some_late, en.portal_tax_oldest_delay, en.portal_tax_no_delay])
            .toEqual(["{share} paid", "{paid} of {original}", "All open claims are late", "{count} late", "Oldest delay", "None"])
        expect([ar.portal_tax_share_paid, ar.portal_tax_paid_of, ar.portal_tax_all_late, ar.portal_tax_some_late, ar.portal_tax_oldest_delay, ar.portal_tax_no_delay])
            .toEqual(["تم سداد {share}", "{paid} من {original}", "كل المطالبات المفتوحة متأخرة", "متأخرة: {count}", "أقدم تأخير", "لا يوجد"])
    })
})

describe("the two cards of bars", () => {
    const list = (html: string, label: string) => new RegExp(`<ul class="ui-bars" aria-label="${esc(label)}">(.*?)</ul>`).exec(html)?.[1] ?? ""
    const rows = (part: string) => [...part.matchAll(/<span class="ui-bars-name">([^<]*)<\/span>.*?<span class="ui-bars-amount ui-num">([^<]*)<\/span>(?: <span class="ui-bars-note">([^<]*)<\/span>)?<\/li>/g)]
        .map(m => [m[1], m[2], m[3] ?? null])

    it("side by side, stacked on phones: what's owed by item, then how late", () => {
        const html = render(POSITION)
        expect(html).toMatch(/<div class="ui-columns"><section class="ui-panel ui-card"><div class="ui-card-head"><h2 class="ui-card-title">What&#x27;s owed by item<\/h2><\/div><ul class="ui-bars".*?<\/ul><\/section><section class="ui-panel ui-card"><div class="ui-card-head"><h2 class="ui-card-title">How late<\/h2><\/div><ul class="ui-bars"/)
    })

    it("by item: the largest first, each with its share of what's owed and its claims, the portal's spellings as one", () => {
        expect(rows(list(render(POSITION), "What's owed by item"))).toEqual([
            ["إقرار ضريبة الدخل", "1,200.00", "78%, 2 claims"],
            ["إقرار القيمة المضافة", "300.25", "19%, 1 claim"],
            ["مساهمة تكافلية لصندوق أسر الشهداء", "40.00", "3%, 1 claim"],
        ])
        // Each bar drawn to what remains, the largest full.
        expect([...list(render(POSITION), "What's owed by item").matchAll(/--part:([\d.]+)%/g)].map(m => Number(m[1]))).toEqual([100, 25.02, 3.33])
        expect([...list(render(POSITION), "How late").matchAll(/--part:([\d.]+)%/g)].map(m => Number(m[1]))).toEqual([4, 30.03, 100, 20])
        expect(rows(list(render(POSITION, "ar"), "المستحق حسب البند"))).toEqual([
            ["إقرار ضريبة الدخل", "١٬٢٠٠٫٠٠", `${percentAr(0.78)}، مطالبتان`],
            ["إقرار القيمة المضافة", "٣٠٠٫٢٥", `${percentAr(0.19)}، مطالبة واحدة`],
            ["مساهمة تكافلية لصندوق أسر الشهداء", "٤٠٫٠٠", `${percentAr(0.03)}، مطالبة واحدة`],
        ])
    })

    it("how late: every row in its order, from not due yet, with its claims, and none at nothing", () => {
        expect(rows(list(render(POSITION), "How late"))).toEqual([
            ["Not due yet", "40.00", "1 claim"],
            ["Under 6 months", "300.25", "1 claim"],
            ["6 months to a year", "0.00", null],
            ["1 to 2 years", "1,000.00", "1 claim"],
            ["More than 2 years", "200.00", "1 claim"],
        ])
        expect(rows(list(render(POSITION, "ar"), "مدة التأخير")).map(r => r[0]))
            .toEqual(["لم يحن موعد سداده", "أقل من ٦ أشهر", "من ٦ أشهر إلى سنة", "من سنة إلى سنتين", "أكثر من سنتين"])
    })

    it("their words", () => {
        expect([en.portal_tax_by_item, en.portal_tax_how_late, en.portal_tax_item_note]).toEqual(["What's owed by item", "How late", "{share}, {claims}"])
        expect([ar.portal_tax_by_item, ar.portal_tax_how_late, ar.portal_tax_item_note]).toEqual(["المستحق حسب البند", "مدة التأخير", "{share}، {claims}"])
        expect([en.portal_tax_late_not_due, en.portal_tax_late_under_6_months, en.portal_tax_late_6_to_12_months, en.portal_tax_late_1_to_2_years, en.portal_tax_late_over_2_years])
            .toEqual(["Not due yet", "Under 6 months", "6 months to a year", "1 to 2 years", "More than 2 years"])
    })
})

describe("the note", () => {
    it("at the end: the currency, the day, that penalties aren't counted, and to contact the office", () => {
        const html = render(POSITION)
        expect(html).toMatch(/<p class="ui-hint ui-portal-note">In Egyptian pounds, as on the Tax Authority&#x27;s portal on 17 Nov 2026\. Penalties for paying late aren&#x27;t counted\. To ask about any claim, contact the office\.<\/p><\/div>$/)
        expect(render(POSITION, "ar")).toContain(`<p class="ui-hint ui-portal-note">بالجنيه المصري، كما على بوابة مصلحة الضرائب بتاريخ ١٧ نوفمبر ٢٠٢٦. لا تُحسب غرامات التأخير في السداد. للاستفسار عن أي مطالبة، يُرجى التواصل مع المكتب.</p>`)
    })
})

describe("its look", () => {
    it("what's owed in two columns, the figure's and the share paid's, one under the other on phones", () => {
        const owed = rule(".ui-portal-owed")
        expect(owed).toMatch(/display: grid;/)
        expect(owed).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/)
        expect(phoneRule(".ui-portal-owed")).toMatch(/grid-template-columns: minmax\(0, 1fr\);/)
        // The badge sits under the figure as wide as its words.
        expect(rule(".ui-portal-owed-figure")).toMatch(/align-items: flex-start;/)
    })

    it("the facts in a row, each a label above its value in --text-xl", () => {
        expect(rule(".ui-portal-facts")).toMatch(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
        const label = rule(".ui-portal-fact dt")
        expect(label).toMatch(/color: var\(--muted\);/)
        expect(label).toMatch(/font-size: var\(--text-sm\);/)
        const value = rule(".ui-portal-fact dd")
        expect(value).toMatch(/font-size: var\(--text-xl\);/)
        expect(value).toMatch(/line-height: var\(--leading-xl\);/)
        expect(value).toMatch(/color: var\(--ink\);/)
    })

    it("on phones one to a line, the label at the start and the value at the end", () => {
        expect(phoneRule(".ui-portal-facts")).toMatch(/grid-template-columns: minmax\(0, 1fr\);/)
        const fact = phoneRule(".ui-portal-fact")
        expect(fact).toMatch(/display: flex;/)
        expect(fact).toMatch(/justify-content: space-between;/)
        expect(phoneRule(".ui-portal-fact dd")).toMatch(/margin: 0;/)
    })
})
