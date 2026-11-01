import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Attendance's Days on the building blocks (UI_PLAN.md §5 step 5, part 3):
 * the month it's about picked under the page header and kept in the address
 * (DESIGN.md §5.3), the month so far as total tiles, and the days as a list,
 * a table on computers and a card per day on phones (§5.4), in the page's
 * language throughout.
 */

const state = {
    locale: "en" as "en" | "ar",
    role: "EMPLOYEE",
    grants: new Set<string>(),
    wide: new Set<string>(),
    keys: [] as (string | null)[],
    days: {} as { data?: unknown; error?: unknown },
    balance: undefined as unknown,
    search: "tab=days",
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p), companyWide: (p: string) => state.wide.has(p) }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null, setSelectedCompanyId: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (key?.startsWith("/api/attendance/people")) {
            return { ...idle, data: { data: { today: "2026-10-31", people: [{ id: "u1", name: "Hana Saad", teamLeaderId: null }, { id: "u2", name: "Sami Nabil", teamLeaderId: null }] } } }
        }
        if (key?.startsWith("/api/attendance/days")) return { ...idle, ...state.days }
        if (key?.startsWith("/api/attendance/permissions/balance")) return { ...idle, data: state.balance }
        return idle
    },
}))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(state.search),
    usePathname: () => "/dashboard/attendance",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

type Day = Record<string, unknown>
const none = { minutes: 0, days: 0, occurrence: 0, note: null }
const day = (fields: Day = {}): Day => ({
    id: "d1", userId: "u1", name: "Hana Saad", date: "2026-10-15", status: "PRESENT",
    firstIn: "2026-10-15T09:12:00", lastOut: "2026-10-15T17:00:00", workedMinutes: 468,
    lateMinutes: 12, earlyLeaveMinutes: 0, overtimeMinutes: 0, excusedMinutes: 0,
    expectedStartMinutes: 540, expectedEndMinutes: 1020,
    deductionDays: 0.25, deductionMinor: 12500, overtimeStatus: "NONE", overtimeMinor: null,
    breakdown: { lateness: { minutes: 12, days: 0.25, occurrence: 3, note: "CHARGED" }, earlyLeave: none, absenceDays: 0, unpriced: null, holiday: null },
    ...fields,
})
const absent = day({ id: "d2", date: "2026-10-16", status: "ABSENT", firstIn: null, lastOut: null, workedMinutes: 0, lateMinutes: 0, deductionDays: 1, deductionMinor: 50000, breakdown: { lateness: none, earlyLeave: none, absenceDays: 1, unpriced: null, holiday: null } })
const rules = { lateness: { enabled: true, freePerMonth: 2 }, earlyLeave: { enabled: false, freePerMonth: 0 } }

async function page({ shows = [day(), absent] as Day[] | "loading" | "failed", truncated = false, role = "EMPLOYEE", grants = [] as string[], wide = [] as string[], locale = "en" as "en" | "ar", search = "tab=days", balance = undefined as unknown } = {}) {
    state.role = role
    state.grants = new Set(grants)
    state.wide = new Set(wide)
    state.locale = locale
    state.search = search
    state.balance = balance
    state.keys = []
    state.days = shows === "loading" ? {}
        : shows === "failed" ? { error: Object.assign(new Error("Request failed"), { info: { error: "Database unavailable" } }) }
            : { data: { data: { days: shows, truncated, limit: 2000, rules } } }
    const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
    return renderToStaticMarkup(h(AttendancePage))
}
const panel = (html: string) => html.slice(html.indexOf('<div role="tabpanel"'))
const period = (html: string) => {
    const at = html.indexOf('class="ui-panel ui-period"')
    if (at < 0) return ""
    const end = html.slice(at).search(/<dl class|<section class|<p class="ui-hint/)
    return html.slice(at, end < 0 ? undefined : at + end)
}
const table = (html: string) => {
    const at = html.indexOf('<table class="ui-table">')
    return at < 0 ? "" : html.slice(at, html.indexOf("</table>", at))
}
const cards = (html: string) => {
    const at = html.indexOf('<ul class="ui-cards"')
    return at < 0 ? "" : html.slice(at, html.indexOf("</ul>", at))
}
const tiles = (html: string) => {
    const at = html.indexOf('<dl class="ui-tiles">')
    return at < 0 ? "" : html.slice(at, html.indexOf("</dl>", at))
}
const daysAsked = () => state.keys.filter(k => k?.startsWith("/api/attendance/days"))

const TEAM = { grants: ["attendance.view_team"], wide: ["attendance.correct"] }

beforeEach(() => {
    // The device is already in November; the company's day is still 31 October.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

describe("the month Days is about", () => {
    it("is picked under the page header, in a month select and a year select, each labelled", async () => {
        const html = panel(await page())
        expect(html.indexOf('class="ui-panel ui-period"')).toBeGreaterThan(-1)
        const bar = period(html)
        expect(bar).toContain('class="ui-label">Month</label>')
        expect(bar).toContain('class="ui-label">Year</label>')
        expect(bar).toMatch(/<option value="10" selected="">October<\/option>/)
        expect(bar).toMatch(/<option value="2026" selected="">2026<\/option>/)
        expect(html).not.toContain('type="month"')
    })

    it("opens on the company's month, not the device's", async () => {
        await page()
        expect(daysAsked()).toEqual(["/api/attendance/days?from=2026-10-01&to=2026-10-31"])
    })

    it("opens on the month its address names, so a reload or a link keeps it", async () => {
        const bar = period(panel(await page({ search: "tab=days&year=2026&month=9" })))
        expect(bar).toMatch(/<option value="9" selected="">September<\/option>/)
        expect(daysAsked()).toEqual(["/api/attendance/days?from=2026-09-01&to=2026-09-30"])
        // One it couldn't be is the company's.
        await page({ search: "tab=days&year=2026&month=13" })
        expect(daysAsked()).toEqual(["/api/attendance/days?from=2026-10-01&to=2026-10-31"])
    })

    it("names its months and years in the page's language", async () => {
        const bar = period(panel(await page({ locale: "ar" })))
        expect(bar).toContain(`class="ui-label">${ar.day_month}</label>`)
        expect(bar).toMatch(/<option value="10" selected="">أكتوبر<\/option>/)
        expect(bar).toContain("٢٠٢٦</option>")
    })

    it("has whose days beside it, for whoever sees other people's, and nobody else", async () => {
        const bar = period(panel(await page(TEAM)))
        expect(bar).toContain('class="ui-label">Person</label>')
        expect(bar).toContain('<option value="" selected="">Everyone</option>')
        expect(bar).toContain('<option value="u2">Sami Nabil</option>')
        expect(period(panel(await page()))).not.toContain(">Person</label>")
    })
})

describe("the days", () => {
    it("are a list named for the month, a table on computers and a card for each on phones", async () => {
        const html = panel(await page())
        expect(html).toContain('<h2 class="ui-section-title">Days in October 2026</h2>')
        expect(table(html)).toContain('<caption class="ui-visually-hidden">Days in October 2026</caption>')
        expect(cards(html)).toMatch(/^<ul class="ui-cards" aria-label="Days in October 2026">/)
        expect(html).not.toContain('<table class="table"')
    })

    it("show each day's date, its status as a badge with what explains it, its times and minutes", async () => {
        const rows = table(panel(await page()))
        expect(rows).toContain('<div class="ui-item-title">Thu 15 Oct</div>')
        expect(rows).toContain('<span class="ui-badge ui-badge-good">Present</span>')
        expect(rows).toContain('<span class="ui-badge ui-badge-problem">Absent</span>')
        expect(rows).toContain("<bdi>09:12</bdi>")
        expect(rows).toContain("<bdi>17:00</bdi>")
        expect(rows).toContain(">12 min<")
        // What a day cost, with its days in words (DESIGN.md §7).
        expect(rows).toContain("<bdi>125.00</bdi>")
        expect(rows).toContain("1 day")
        expect(rows).not.toContain("day(s)")
    })

    it("say whose each day is when the list is everyone's", async () => {
        const rows = table(panel(await page({ ...TEAM, shows: [day(), day({ id: "d3", userId: "u2", name: "Sami Nabil" })] })))
        expect(rows).toContain('<div class="ui-item-detail">Sami Nabil</div>')
    })

    it("are dated, timed and counted in Arabic on the Arabic page", async () => {
        const html = panel(await page({ locale: "ar" }))
        expect(html).toContain(`<h2 class="ui-section-title">${ar.day_list_title.replace("{month}", "أكتوبر ٢٠٢٦")}</h2>`)
        const rows = table(html)
        expect(rows).toContain("١٥ أكتوبر")
        expect(rows).toContain("<bdi>٠٩:١٢</bdi>")
        expect(rows).toContain("١٢ دقيقة")
        expect(rows).toContain("١٢٥٫٠٠")
        expect(rows).toContain(`<span class="ui-badge ui-badge-good">${ar.audit_value_PRESENT}</span>`)
    })

    it("offer one's own day what can be asked about it, as the building blocks' buttons", async () => {
        const rows = table(panel(await page({ shows: [day(), day({ id: "d4", date: "2026-10-20", status: "INCOMPLETE", lastOut: null, lateMinutes: 0 })] })))
        expect(rows).toMatch(/<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">[^<]*Ask for permission<\/button>/)
        expect(rows).toMatch(/<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">[^<]*Report a missing punch<\/button>/)
        expect(rows).not.toContain('class="btn')
    })

    it("say there are none yet, while they load, and when they didn't, with the server's word and Try again", async () => {
        expect(panel(await page({ shows: [] }))).toContain(`<p class="ui-empty-title">${en.day_none}</p>`)
        expect(panel(await page({ shows: "loading" }))).toContain(`<p class="ui-empty-title">${en.loading}</p>`)
        const failed = panel(await page({ shows: "failed" }))
        expect(failed).toContain(`<p class="ui-empty-title">${en.day_load_failed.replace("'", "&#x27;")}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })

    it("are recalculated from the list's heading, by whoever corrects the company's attendance", async () => {
        const html = panel(await page(TEAM))
        expect(html).toMatch(/<div class="ui-section-head"><h2 class="ui-section-title">Days in October 2026<\/h2><button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">[^<]*Recalculate this month<\/button><\/div>/)
        expect(panel(await page())).not.toContain("Recalculate this month")
    })
})

describe("the month so far", () => {
    it("is one person's, as total tiles above the list, in the page's digits", async () => {
        const html = panel(await page({ balance: { data: { enabled: true, remainingMinutes: 90, allowanceMinutes: 120, carriedMinutes: 0 } } }))
        const top = tiles(html)
        expect(html.indexOf('<dl class="ui-tiles">')).toBeLessThan(html.indexOf('<table class="ui-table">'))
        expect(top).toContain("<dt>Deductions so far</dt><dd>625.00</dd>")
        expect(top).toContain("1.25 days")
        expect(top).toContain("<dt>Late arrivals</dt><dd>1</dd>")
        expect(top).toContain("<dt>Absences</dt><dd>1</dd>")
        expect(top).toContain("<dt>Permission left</dt><dd>90 min</dd>")
        const arTiles = tiles(panel(await page({ locale: "ar" })))
        expect(arTiles).toContain("<dd>٦٢٥٫٠٠</dd>")
    })

    it("is everyone's deductions in one tile when the list is everyone's", async () => {
        const top = tiles(panel(await page(TEAM)))
        expect(top).toContain("<dt>Total deductions</dt><dd>625.00</dd>")
        expect(top).not.toContain("Late arrivals")
    })

    it("isn't added up from a list cut short, which says so instead", async () => {
        const html = panel(await page({ ...TEAM, truncated: true }))
        expect(tiles(html)).toBe("")
        expect(html).toContain(en.day_truncated.replace("{n}", "2,000"))
    })
})

describe("found in the interface audit (PR 149)", () => {
    it("gives a deduction's days to the eighth, as they're kept, not rounded to two places", async () => {
        // An eighth of a day showed as 0.13, and a month's 1.375 as 1.38.
        const html = panel(await page({ shows: [day({ deductionDays: 0.125, deductionMinor: 6250 }), absent, day({ id: "d5", date: "2026-10-17", deductionDays: 0.25, deductionMinor: 12500 })] }))
        expect(table(html)).toContain("0.125 days")
        expect(tiles(html)).toContain("1.375 days")
    })

    it("spaces the tab's blocks as the page spaces its own", async () => {
        const html = await page()
        expect(html).toContain('<div role="tabpanel" id="attendance-panel" class="ui-tab-panel" aria-labelledby="attendance-tab-days">')
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-tab-panel \{\s*display: flex;\s*flex-direction: column;\s*gap: var\(--space-6\);/)
    })

    it("writes a phone card's times as one line, and none for a day with no punch", async () => {
        // Each piece was spaced apart as its own item: "In 09:12 , Out 17:00".
        const list = cards(panel(await page()))
        expect(list).toContain("<span>In <bdi>09:12</bdi>, Out <bdi>17:00</bdi></span>")
        const absentCard = list.slice(list.indexOf("Fri 16 Oct"))
        expect(absentCard.slice(0, absentCard.indexOf("</li>"))).not.toContain("In ")
    })
})

describe("Days is on the building blocks", () => {
    const SOURCE = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
    const days = SOURCE.slice(SOURCE.indexOf("// --- Days"), SOURCE.indexOf("// --- Punches"))

    it("has no hand-made styles, old buttons, old table or spinner left", () => {
        expect(days).not.toContain("style={{")
        expect(days).not.toMatch(/className=\{?['"`](btn|input|label|glass|table)/)
        expect(days).not.toContain("LoadingSpinner")
        expect(days).toContain("<DataList")
        expect(days).toContain("<PeriodBar>")
    })

    it("keeps the month in the address, from the company's date", () => {
        expect(days).toContain("periodFromAddress(params, new Date(`${today}T12:00:00`))")
        expect(days).toContain("router.replace(addressWithPeriod(pathname, params.toString(), y, m), { scroll: false })")
    })
})

describe("a day's status (DESIGN.md §3.4)", () => {
    it("is written in sentence case", () => {
        expect([en.audit_value_LEAVE, en.audit_value_REST, en.audit_value_WORKED_REST_DAY, en.audit_value_WORKED_HOLIDAY, en.audit_value_NO_SCHEDULE])
            .toEqual(["On leave", "Rest day", "Worked a rest day", "Worked a holiday", "No schedule"])
    })
})
