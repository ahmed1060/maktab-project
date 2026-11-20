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
    it("the client's name above Tax position, and where the figures come from and the day they were last updated", () => {
        expect(render(POSITION)).toContain(`<p class="ui-page-subtitle">From the Tax Authority&#x27;s portal, last updated 17\u00a0Nov\u00a02026.</p>`)
        expect(render(POSITION, "ar")).toContain(`<p class="ui-page-subtitle">من بوابة مصلحة الضرائب، آخر تحديث ١٧\u00a0نوفمبر\u00a0٢٠٢٦.</p>`)
        expect(en.portal_tax_from).toBe("From the Tax Authority's portal, last updated {date}.")
        expect(ar.portal_tax_from).toBe("من بوابة مصلحة الضرائب، آخر تحديث {date}.")
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
            const day = locale === "ar" ? "١٧ نوفمبر ٢٠٢٦" : "17 Nov 2026"
            expect(text(html), locale).toContain(`${words.tax_no_open_claims}${words.tax_no_open_claims_detail.replace("{date}", day)}`)
            expect(html, locale).not.toMatch(/ui-large-figure|ui-bars|ui-share|ui-portal-note/)
        }
    })
})

describe("what's owed", () => {
    it("a panel headed by its label, What the company owes, then what remains as the page's one large figure, its currency after it", () => {
        const html = render(POSITION)
        expect(html).toContain(`<section class="ui-panel ui-portal-owed" aria-labelledby="portal-tax-owed"><div class="ui-portal-owed-figure"><h2 id="portal-tax-owed" class="ui-portal-owed-label">What the company owes</h2>`)
        expect(html).toContain(`<p class="ui-large-figure"><span class="ui-large-figure-value ui-num">1,540.25</span> <span class="ui-large-figure-unit">EGP</span></p>`)
        const arabic = render(POSITION, "ar")
        expect(arabic).toContain(`<h2 id="portal-tax-owed" class="ui-portal-owed-label">المستحق على الشركة</h2>`)
        expect(arabic).toContain(`<p class="ui-large-figure"><span class="ui-large-figure-value ui-num">١٬٥٤٠٫٢٥</span> <span class="ui-large-figure-unit">${ar.egp}</span></p>`)
        // Not a card's title (DESIGN.md §5.5, as the owner's mockup draws it).
        expect(html).not.toContain(`<h2 class="ui-card-title">${en.tax_owed}`)
    })

    it("a Problem badge with a warning icon under it, saying how many are late, or that all are where there's more than one", () => {
        const badge = (position: PortalTaxPosition, locale: "en" | "ar" = "en") => {
            const inner = /<span class="ui-badge ui-badge-problem">(.*?)<\/span>/.exec(render(position, locale))?.[1]
            return inner === undefined ? undefined : { icon: /^<svg[^>]*aria-hidden="true"/.test(inner), words: text(inner) }
        }
        expect(badge(POSITION)).toEqual({ icon: true, words: "3 claims late" })
        expect(badge(POSITION, "ar")).toEqual({ icon: true, words: "متأخرة السداد: ٣ مطالبات" })
        const allLate = summarise(CLAIMS.slice(0, 2), TODAY, AS_OF)
        expect(badge(allLate)?.words).toBe("All open claims are late")
        expect(badge(allLate, "ar")?.words).toBe("كل المطالبات المفتوحة متأخرة السداد")
        // One late claim of one is how many, not all.
        expect(badge(summarise(CLAIMS.slice(0, 1), TODAY, AS_OF))?.words).toBe("1 claim late")
        expect(badge(summarise(CLAIMS.slice(3), TODAY, AS_OF))).toBeUndefined()
        // Nothing late, no badge in what's owed (the claims card below has its own, PR 339).
        expect(/<section class="ui-panel ui-portal-owed".*?<\/section>/.exec(render(summarise(CLAIMS.slice(3), TODAY, AS_OF)))?.[0]).not.toContain("ui-badge")
    })

    it("the badge is under the figure, and the share paid and the facts beside it", () => {
        const html = render(POSITION)
        expect(html).toMatch(/<section class="ui-panel ui-portal-owed"[^>]*><div class="ui-portal-owed-figure"><h2[^>]*>.*?<\/h2><p class="ui-large-figure">.*?<\/p><p class="ui-portal-owed-late"><span class="ui-badge ui-badge-problem">.*?<\/span><\/p><\/div><div class="ui-portal-owed-paid"><div class="ui-share">.*?<\/div><dl class="ui-portal-facts">/)
    })

    it("how much of the open claims' original amounts is paid, to the nearest whole percent, its amounts with the currency", () => {
        // 210.25 of 1,750.50 is 12.01%.
        const html = render(POSITION)
        expect(html).toContain(`<p class="ui-share-line"><span class="ui-share-words">12% of the total claims paid</span> <span class="ui-share-amounts ui-num">210.25 of 1,750.50 EGP</span></p>`)
        expect(html).toContain(`style="--share:12%"`)
        const arabic = render(POSITION, "ar")
        expect(arabic).toContain(`<span class="ui-share-words">تم سداد ${percentAr(0.12)} من إجمالي المطالبات</span> <span class="ui-share-amounts ui-num">٢١٠٫٢٥ من ١٬٧٥٠٫٥٠ ${ar.egp}</span>`)
    })

    it("as the owner's mockup says it: 7,365.00 of 46,163.37 is 16% paid", () => {
        const html = render(summarise([claim("8", "إقرار تجاري", 46163.37, 7365, "2026-04-30")], TODAY, AS_OF))
        expect(html).toContain(`<span class="ui-share-words">16% of the total claims paid</span>`)
        expect(html).toContain(`style="--share:16%"`)
    })

    it("never 100% while something is left to pay", () => {
        // 995 of 1,000 is 99.5%: 99% paid, not 100%.
        const html = render(summarise([claim("9", "إقرار شهري", 1000, 995, "2026-12-31")], TODAY, AS_OF))
        expect(html).toContain(`<span class="ui-share-words">99% of the total claims paid</span>`)
        expect(html).toContain(`style="--share:99%"`)
    })

    it("the share is worked out on whole piasters to the nearest whole percent, a float a hair off them counting as them, 99% at most while something is left", async () => {
        const { paidShare } = await import("./portal-tax")
        expect(paidShare(29, 100)).toBe(0.29)
        expect(paidShare(57, 100)).toBe(0.57)
        expect(paidShare(210.25, 1750.5)).toBe(0.12)
        expect(paidShare(7365, 46163.37)).toBe(0.16)
        expect(paidShare(12.5, 100)).toBe(0.13)
        // A half percent a hair under it in floating point (14.499999999999998) is still a half.
        expect(paidShare(14.5, 100)).toBe(0.15)
        expect(paidShare(57.5, 100)).toBe(0.58)
        expect(paidShare(0.4, 100)).toBe(0)
        expect(paidShare(999.99, 1000)).toBe(0.99)
        // Codex's case on PR 338: a piaster left of 100,000 is still 99%.
        expect(paidShare(99999.99, 100000)).toBe(0.99)
        // Worked out on whole piasters, so a share just under a half (14.49996%) isn't rounded up.
        expect(paidShare(14499.96, 100000)).toBe(0.14)
        expect(paidShare(14500, 100000)).toBe(0.15)
        // A sum a hair off its piasters counts as them.
        expect(paidShare(7365.000000001, 46163.37)).toBe(0.16)
        expect(paidShare(0.1 + 0.2, 1)).toBe(0.3)
        // 0.29 is 28.999999999999996 piasters in floating point: 0.29 of 2.00 is still 14.5%, so 15%.
        expect(paidShare(0.29, 2)).toBe(0.15)
        expect(paidShare(1000, 1000)).toBe(1)
        expect(paidShare(0, 1000)).toBe(0)
        expect(paidShare(5, 0)).toBe(0)
    })

    it("three facts: open claims, paid with its currency, and the oldest delay in days, or None", () => {
        const facts = (html: string) => [...html.matchAll(/<div class="ui-portal-fact"><dt>([^<]*)<\/dt><dd class="ui-num">(.*?)<\/dd><\/div>/g)].map(m => [m[1], text(m[2])])
        // The days kept with their number.
        expect(facts(render(POSITION))).toEqual([["Open claims", "4"], ["Paid", "210.25 EGP"], ["Oldest delay", "963 days"]])
        expect(facts(render(POSITION, "ar"))).toEqual([["المطالبات المفتوحة", "٤"], ["المسدد", `٢١٠٫٢٥ ${ar.egp}`], ["أقدم تأخير", "٩٦٣ يومًا"]])
        // The paid fact's currency after it, muted.
        expect(render(POSITION)).toContain(`<dd class="ui-num">210.25 <span class="ui-portal-fact-unit">EGP</span></dd>`)
        const onTime = summarise(CLAIMS.slice(3), TODAY, AS_OF)
        expect(facts(render(onTime))[2]).toEqual(["Oldest delay", "None"])
        expect(facts(render(onTime, "ar"))[2]).toEqual(["أقدم تأخير", "لا يوجد"])
    })

    it("its words", () => {
        expect([en.portal_tax_owed, en.portal_tax_share_paid, en.portal_tax_paid_of, en.portal_tax_all_late, en.portal_tax_some_late, en.portal_tax_open_claims, en.portal_tax_oldest_delay, en.portal_tax_no_delay])
            .toEqual(["What the company owes", "{share} of the total claims paid", "{paid} of {original} {currency}", "All open claims are late", "{count} late", "Open claims", "Oldest delay", "None"])
        expect([ar.portal_tax_owed, ar.portal_tax_share_paid, ar.portal_tax_paid_of, ar.portal_tax_all_late, ar.portal_tax_some_late, ar.portal_tax_open_claims, ar.portal_tax_oldest_delay, ar.portal_tax_no_delay])
            .toEqual(["المستحق على الشركة", "تم سداد {share} من إجمالي المطالبات", "{paid} من {original} {currency}", "كل المطالبات المفتوحة متأخرة السداد", "متأخرة السداد: {count}", "المطالبات المفتوحة", "أقدم تأخير", "لا يوجد"])
    })
})

describe("the two cards of bars", () => {
    const list = (html: string, label: string) => new RegExp(`<ul class="ui-bars" aria-label="${esc(label)}">(.*?)</ul>`).exec(html)?.[1] ?? ""
    // Each row's name as it's seen (a short one where it has one), amount and note.
    const rows = (part: string) => [...part.matchAll(/<span class="ui-bars-name">(?:<span aria-hidden="true">([^<]*)<\/span><span class="ui-visually-hidden">[^<]*<\/span>|([^<]*))<\/span>.*?<span class="ui-bars-amount ui-num">([^<]*)<\/span>(?: <span class="ui-bars-note">([^<]*)<\/span>)?<\/li>/g)]
        .map(m => [m[1] ?? m[2], m[3], m[4] ?? null])

    it("side by side, stacked on phones: what's owed by item, then how late, each title with a line under it", () => {
        const html = render(POSITION)
        expect(html).toMatch(/<div class="ui-columns"><section class="ui-panel ui-card"><div class="ui-card-head"><div class="ui-card-heading"><h2 class="ui-card-title">What&#x27;s owed by item<\/h2><p class="ui-card-subtitle">Largest first<\/p><\/div><\/div><ul class="ui-bars".*?<\/ul><\/section><section class="ui-panel ui-card"><div class="ui-card-head"><div class="ui-card-heading"><h2 class="ui-card-title">How late<\/h2><p class="ui-card-subtitle">From the last day to pay until today<\/p><\/div><\/div><ul class="ui-bars"/)
        expect(render(POSITION, "ar")).toContain(`<p class="ui-card-subtitle">من الأكبر إلى الأصغر</p>`)
        expect(render(POSITION, "ar")).toContain(`<p class="ui-card-subtitle">من آخر موعد للسداد حتى اليوم</p>`)
    })

    it("by item: the largest first, each with its share of what's owed and its claims, the portal's spellings as one", () => {
        expect(rows(list(render(POSITION), "What's owed by item"))).toEqual([
            ["إقرار ضريبة الدخل", "1,200.00", "78% of what's owed, 2 claims"],
            ["إقرار القيمة المضافة", "300.25", "19% of what's owed, 1 claim"],
            ["صندوق أسر الشهداء", "40.00", "3% of what's owed, 1 claim"],
        ].map(([name, amount, note]) => [name, amount, esc(note)]))
        // Each bar drawn to what remains, the largest full.
        expect([...list(render(POSITION), "What's owed by item").matchAll(/--part:([\d.]+)%/g)].map(m => Number(m[1]))).toEqual([100, 25.02, 3.33])
        expect([...list(render(POSITION), "How late").matchAll(/--part:([\d.]+)%/g)].map(m => Number(m[1]))).toEqual([4, 30.03, 100, 20])
        expect(rows(list(render(POSITION, "ar"), "المستحق حسب البند"))).toEqual([
            ["إقرار ضريبة الدخل", "١٬٢٠٠٫٠٠", `${percentAr(0.78)} من المستحق، مطالبتان`],
            ["إقرار القيمة المضافة", "٣٠٠٫٢٥", `${percentAr(0.19)} من المستحق، مطالبة واحدة`],
            ["صندوق أسر الشهداء", "٤٠٫٠٠", `${percentAr(0.03)} من المستحق، مطالبة واحدة`],
        ])
    })

    it("the two usual items with long names go by short ones, their full names when pointed at and for screen readers", async () => {
        const { shortItemName } = await import("./portal-tax")
        expect(shortItemName("مساهمة تكافلية - تأمين صحي")).toBe("تأمين صحي")
        expect(shortItemName("مساهمة تكافلية لصندوق أسر الشهداء")).toBe("صندوق أسر الشهداء")
        // Matched as the upload matches spellings.
        expect(shortItemName("مساهمه تكافليه لصندوق اسر الشهداء")).toBe("صندوق أسر الشهداء")
        // Any other item keeps its name.
        expect(shortItemName("إقرار ضريبة الدخل")).toBe("إقرار ضريبة الدخل")
        expect(shortItemName("رسم تنمية الموارد")).toBe("رسم تنمية الموارد")
        expect(list(render(POSITION), "What's owed by item")).toContain(`title="مساهمة تكافلية لصندوق أسر الشهداء: 40.00"><span class="ui-bars-name"><span aria-hidden="true">صندوق أسر الشهداء</span><span class="ui-visually-hidden">مساهمة تكافلية لصندوق أسر الشهداء</span></span>`)
    })

    it("how late: every row in its order, from not due yet, with its claims, or No claims at nothing", () => {
        expect(rows(list(render(POSITION), "How late"))).toEqual([
            ["Not due yet", "40.00", "1 claim"],
            ["Under 6 months", "300.25", "1 claim"],
            ["6 months to a year", "0.00", "No claims"],
            ["1 to 2 years", "1,000.00", "1 claim"],
            ["More than 2 years", "200.00", "1 claim"],
        ])
        expect(rows(list(render(POSITION, "ar"), "مدة التأخير"))[2]).toEqual(["من ٦ شهور إلى سنة", "٠٫٠٠", "لا مطالبات"])
        expect(rows(list(render(POSITION, "ar"), "مدة التأخير")).map(r => r[0]))
            .toEqual(["لم يحن موعد سداده", "أقل من ٦ شهور", "من ٦ شهور إلى سنة", "من سنة إلى سنتين", "أكثر من سنتين"])
    })

    it("their words", () => {
        expect([en.portal_tax_by_item, en.portal_tax_by_item_hint, en.portal_tax_how_late, en.portal_tax_how_late_hint, en.portal_tax_item_note, en.portal_tax_no_claims])
            .toEqual(["What's owed by item", "Largest first", "How late", "From the last day to pay until today", "{share} of what's owed, {claims}", "No claims"])
        expect([ar.portal_tax_by_item, ar.portal_tax_by_item_hint, ar.portal_tax_how_late, ar.portal_tax_how_late_hint, ar.portal_tax_item_note, ar.portal_tax_no_claims])
            .toEqual(["المستحق حسب البند", "من الأكبر إلى الأصغر", "مدة التأخير", "من آخر موعد للسداد حتى اليوم", "{share} من المستحق، {claims}", "لا مطالبات"])
        expect([en.portal_tax_late_not_due, en.portal_tax_late_under_6_months, en.portal_tax_late_6_to_12_months, en.portal_tax_late_1_to_2_years, en.portal_tax_late_over_2_years])
            .toEqual(["Not due yet", "Under 6 months", "6 months to a year", "1 to 2 years", "More than 2 years"])
    })
})

describe("the note", () => {
    it("at the end: the currency, the day, that penalties aren't counted, and to contact the office", () => {
        const html = render(POSITION)
        expect(html).toMatch(/<p class="ui-portal-note">Amounts are in Egyptian pounds, as they were on the Tax Authority&#x27;s portal on 17\u00a0Nov\u00a02026, and penalties for paying late aren&#x27;t counted\. To ask about any claim, contact the office\.<\/p><\/div>$/)
        expect(render(POSITION, "ar")).toContain(`<p class="ui-portal-note">المبالغ بالجنيه المصري كما هي على بوابة مصلحة الضرائب يوم ١٧\u00a0نوفمبر\u00a0٢٠٢٦، وغرامات التأخير غير محسوبة. للاستفسار عن أي مطالبة، يُرجى التواصل مع المكتب.</p>`)
    })

    it("in --text-xs and --muted", () => {
        const note = rule(".ui-portal-note")
        expect(note).toMatch(/font-size: var\(--text-xs\);/)
        expect(note).toMatch(/color: var\(--muted\);/)
    })
})

describe("its look", () => {
    it("what's owed 24px inside, the share paid twice the figure's width, one under the other on phones", () => {
        const owed = rule(".ui-portal-owed")
        expect(owed).toMatch(/display: grid;/)
        expect(owed).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2fr\);/)
        expect(owed).toMatch(/gap: var\(--space-6\) var\(--space-12\);/)
        expect(owed).toMatch(/padding: var\(--space-6\);/)
        expect(phoneRule(".ui-portal-owed")).toMatch(/grid-template-columns: minmax\(0, 1fr\);/)
        // The badge sits under the figure as wide as its words.
        expect(rule(".ui-portal-owed-figure")).toMatch(/align-items: flex-start;/)
    })

    it("its label in --text-md, weight 500, --muted", () => {
        const label = rule(".ui-portal-owed-label")
        expect(label).toMatch(/font-size: var\(--text-md\);/)
        expect(label).toMatch(/font-weight: 500;/)
        expect(label).toMatch(/color: var\(--muted\);/)
    })

    it("the facts in a row under a line across, each a label in --text-xs above its value in --text-xl, weight 600", () => {
        const facts = rule(".ui-portal-facts")
        expect(facts).toMatch(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
        expect(facts).toMatch(/border-block-start: 1px solid var\(--rule\);/)
        expect(facts).toMatch(/padding-block-start: var\(--space-4\);/)
        const label = rule(".ui-portal-fact dt")
        expect(label).toMatch(/color: var\(--muted\);/)
        expect(label).toMatch(/font-size: var\(--text-xs\);/)
        const value = rule(".ui-portal-fact dd")
        expect(value).toMatch(/font-size: var\(--text-xl\);/)
        expect(value).toMatch(/font-weight: 600;/)
        expect(value).toMatch(/color: var\(--ink\);/)
        const unit = rule(".ui-portal-fact-unit")
        expect(unit).toMatch(/font-size: var\(--text-sm\);/)
        expect(unit).toMatch(/color: var\(--muted\);/)
    })

    it("on phones one to a line between lines, the label at the start in --text-sm and the value at the end in --text-lg", () => {
        expect(phoneRule(".ui-portal-facts")).toMatch(/grid-template-columns: minmax\(0, 1fr\);\s*gap: 0;\s*padding-block-start: 0;/)
        const fact = phoneRule(".ui-portal-fact")
        expect(fact).toMatch(/display: flex;/)
        expect(fact).toMatch(/justify-content: space-between;/)
        expect(fact).toMatch(/padding-block: var\(--space-3\);/)
        expect(fact).toMatch(/border-block-end: 1px solid var\(--rule\);/)
        expect(phoneRule(".ui-portal-fact:last-child")).toMatch(/border-block-end: 0;/)
        expect(phoneRule(".ui-portal-fact dt")).toMatch(/font-size: var\(--text-sm\);/)
        const value = phoneRule(".ui-portal-fact dd")
        expect(value).toMatch(/margin: 0;/)
        expect(value).toMatch(/font-size: var\(--text-lg\);/)
    })

    it("a card's title can have a line under it, in --text-xs and --muted", () => {
        const line = rule(".ui-card-subtitle")
        expect(line).toMatch(/font-size: var\(--text-xs\);/)
        expect(line).toMatch(/color: var\(--muted\);/)
    })
})
