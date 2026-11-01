import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Public holidays on the building blocks (UI_PLAN.md §5 step 5, PR 146): the
 * page header with Add, the year it's about picked under it and kept in its
 * address (DESIGN.md §5.3), the year's holidays in a card with a menu on
 * each, and adding, editing and removing one in the building blocks' dialog.
 */

const state = {
    locale: "en" as "en" | "ar",
    role: "SUPER_ADMIN",
    sessionStatus: "authenticated" as "authenticated" | "loading",
    keys: [] as (string | null)[],
    result: {} as { data?: unknown; error?: unknown },
    search: "",
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.sessionStatus === "loading" ? null : { user: { id: "sa", role: state.role } }, status: state.sessionStatus }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        return key ? { ...idle, ...state.result } : idle
    },
}))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(state.search),
    usePathname: () => "/dashboard/public-holidays",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

type Holiday = { id: string; date: string; name: string; nameAr: string | null; companiesSkipping: number }
const holiday = (fields: Partial<Holiday> = {}): Holiday => ({ id: "h1", date: "2026-10-06", name: "Armed Forces Day", nameAr: "عيد القوات المسلحة", companiesSkipping: 0, ...fields })

async function page({ shows, role = "SUPER_ADMIN", locale = "en", search = "", sessionStatus = "authenticated" }: { shows?: Holiday[] | "loading" | "failed"; role?: string; locale?: "en" | "ar"; search?: string; sessionStatus?: "authenticated" | "loading" } = {}) {
    state.role = role
    state.locale = locale
    state.search = search
    state.sessionStatus = sessionStatus
    state.keys = []
    state.result = shows === "loading" || shows === undefined ? {}
        : shows === "failed" ? { error: Object.assign(new Error("Request failed"), { info: { error: "Database unavailable" } }) }
            : { data: { data: { holidays: shows } } }
    const { default: PublicHolidaysPage } = await import("@/app/(dashboard)/dashboard/public-holidays/page")
    return renderToStaticMarkup(h(PublicHolidaysPage))
}
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
const period = (html: string) => {
    const at = html.indexOf('class="ui-panel ui-period"')
    return at < 0 ? "" : html.slice(at, html.indexOf("</div></div>", at))
}
const card = (html: string) => {
    const at = html.indexOf('<h2 class="ui-card-title">')
    return at < 0 ? "" : html.slice(html.lastIndexOf('<section class="ui-panel ui-card"', at), html.indexOf("</section>", at) + "</section>".length)
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-15T09:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

describe("Public holidays' page header", () => {
    it("names the page, says what it's for, and holds Add", async () => {
        const top = header(await page({ shows: [] }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.public_holidays_title}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${en.public_holidays_hint}</p>`)
        expect(top).toMatch(/<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary">.*Add a public holiday<\/button><\/div>/)
    })

    it("is the Super Admin's only, and nobody else's page asks the server anything", async () => {
        const html = await page({ shows: [holiday()], role: "ADMIN" })
        expect(html).not.toContain("ui-page-header")
        expect(state.keys.every(k => k === null)).toBe(true)
    })
})

describe("the year Public holidays is about", () => {
    it("is picked under the header, labelled, and asks for that year", async () => {
        const bar = period(await page({ shows: [] }))
        expect(bar).toContain('class="ui-label">Year</label>')
        expect(bar).toMatch(/<option value="2026" selected="">2026<\/option>/)
        expect(state.keys).toContain("/api/public-holidays?year=2026")
    })

    it("opens on the year its address names, so a reload or a link keeps it", async () => {
        const bar = period(await page({ shows: [], search: "year=2027" }))
        expect(bar).toMatch(/<option value="2027" selected="">2027<\/option>/)
        expect(state.keys).toContain("/api/public-holidays?year=2027")
        // A year further off, from a link, is offered in its place.
        expect(period(await page({ shows: [], search: "year=2019" }))).toMatch(/<option value="2019" selected="">2019<\/option>/)
        // One it couldn't be is this year.
        await page({ shows: [], search: "year=abc" })
        expect(state.keys).toContain("/api/public-holidays?year=2026")
    })

    it("names its years in the page's language", async () => {
        expect(period(await page({ shows: [], locale: "ar" }))).toContain("٢٠٢٦</option>")
    })
})

describe("the year's holidays", () => {
    it("are a card named for the year, a row for each with its day and a menu named for it", async () => {
        const part = card(await page({ shows: [holiday(), holiday({ id: "h2", date: "2026-10-25", name: "Founding Day", nameAr: null, companiesSkipping: 1 })] }))
        expect(part).toMatch(/^<section class="ui-panel ui-card"><div class="ui-card-head"><h2 class="ui-card-title">Holidays in 2026<\/h2><\/div><ul class="ui-rows" aria-label="Holidays in 2026">/)
        expect(part).toContain('<span class="ui-item-title"><bdi>Armed Forces Day</bdi></span>')
        expect(part).toContain('<span class="ui-item-detail">Tue 6 October</span>')
        // A count with its word, one or many (DESIGN.md §7).
        expect(part).toContain('<span class="ui-item-detail">Sun 25 October · Worked through by 1 company</span>')
        expect(part).toContain('aria-label="More actions for Armed Forces Day"')
        expect(part).not.toContain("style=")
    })

    it("are named and dated in Arabic on the Arabic page, the English name where there's no Arabic one", async () => {
        const part = card(await page({ shows: [holiday({ companiesSkipping: 3 }), holiday({ id: "h2", name: "Founding Day", nameAr: null })], locale: "ar" }))
        expect(part).toContain("<bdi>عيد القوات المسلحة</bdi>")
        expect(part).toContain("<bdi>Founding Day</bdi>")
        expect(part).toContain("الثلاثاء، ٦ أكتوبر")
        expect(part).toContain("تعمل فيها ٣ شركات")
    })

    it("says there are none yet, with Add, when the year has none", async () => {
        const part = card(await page({ shows: [] }))
        expect(part).toContain(`<p class="ui-empty-title">${en.attendance_no_holidays}</p>`)
        expect(part).toContain("Add a public holiday</button>")
    })

    it("says while they load, and when they didn't, with the server's word and Try again", async () => {
        expect(await page({ shows: "loading" })).toContain(`<p class="ui-empty-title">${en.loading}</p>`)
        const failed = await page({ shows: "failed" })
        expect(failed).toContain(`<p class="ui-empty-title">${en.public_holidays_load_failed.replace("'", "&#x27;")}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })
})

describe("Public holidays is on the building blocks throughout", () => {
    const PAGE = readFileSync("app/(dashboard)/dashboard/public-holidays/page.tsx", "utf8")

    it("has no hand-made styles, old modal or old header left", () => {
        expect(PAGE).not.toContain("style={{")
        expect(PAGE).not.toContain("ConfirmModal")
        expect(PAGE).not.toContain("useHeader")
        expect(PAGE).not.toMatch(/className="(glass|btn|input|label)/)
    })

    it("adds and edits in the building blocks' dialog, saying under each field what's missing", () => {
        expect(PAGE).toMatch(/<Dialog\s+open=\{draft !== null\}/)
        expect(PAGE).toContain("t('public_holidays_date_required')")
        expect(PAGE).toContain("t('public_holidays_name_required')")
        // Moving a holiday says what it moves.
        expect(PAGE).toContain("t('public_holidays_move_hint')")
    })

    it("removes in the building blocks' dialog, its confirm the danger button", () => {
        expect(PAGE).toMatch(/<Dialog\s+open=\{removing !== null\}/)
        expect(PAGE).toMatch(/<Button variant="danger"[\s\S]*?>\s*\{t\('delete'\)\}\s*<\/Button>/)
    })

    it("follows a holiday saved into another year there, through the address", () => {
        expect(PAGE).toContain("if (savedYear !== year) setYear(savedYear)")
        expect(PAGE).toContain("router.replace(addressWithYear(pathname, params.toString(), y), { scroll: false })")
    })
})
