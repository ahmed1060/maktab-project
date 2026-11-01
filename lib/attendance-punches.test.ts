import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Attendance's Punches on the building blocks (UI_PLAN.md §5 step 5, part 4):
 * the month picked under the page header as on Days, kept in the address and
 * shared with it, with a day of it and whose punches beside it (DESIGN.md
 * §5.3); the punches as a list, a table on computers and a card for each on
 * phones (§5.4); and withdrawing one in the building blocks' dialog.
 */

const state = {
    locale: "en" as "en" | "ar",
    role: "EMPLOYEE",
    grants: new Set<string>(),
    wide: new Set<string>(),
    keys: [] as (string | null)[],
    punches: {} as { data?: unknown; error?: unknown },
    search: "tab=punches",
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: (p: string) => state.grants.has(p), companyWide: (p: string) => state.wide.has(p), canFor: (p: string) => state.grants.has(p) || state.wide.has(p) }),
}))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null, setSelectedCompanyId: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (key?.startsWith("/api/attendance/people")) {
            return { ...idle, data: { data: { today: "2026-10-31", people: [{ id: "u1", name: "Hana Saad", teamLeaderId: null }, { id: "u2", name: "Sami Nabil", teamLeaderId: null }] } } }
        }
        if (key?.startsWith("/api/attendance/punches")) return { ...idle, ...state.punches }
        return idle
    },
}))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(state.search),
    usePathname: () => "/dashboard/attendance",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

type Punch = Record<string, unknown>
const punch = (fields: Punch = {}): Punch => ({
    id: "p1", userId: "u2", name: "Sami Nabil", hardwareUserId: null, source: "MOBILE", at: "2026-10-15T09:12:00",
    direction: "IN", note: null, deviceName: null, placeName: "Head office", status: "ACCEPTED", flagReasons: [], voidedAt: null, voidReason: null,
    ...fields,
})
const unmatched = punch({ id: "p2", userId: null, name: null, hardwareUserId: "117", source: "IMPORT", at: "2026-10-16T17:03:00", direction: "OUT", placeName: null })
const withdrawn = punch({ id: "p3", source: "MANUAL", at: "2026-10-14T08:00:00", note: "Forgot to punch in", voidedAt: "2026-10-14T12:00:00Z", voidReason: "Typed the wrong day" })
const flagged = punch({ id: "p4", at: "2026-10-13T08:58:00", status: "FLAGGED", flagReasons: ["OUTSIDE_AREA"] })
const own = punch({ id: "p5", userId: "u1", name: "Hana Saad", at: "2026-10-12T09:00:00" })

async function page({ shows = [punch(), unmatched, withdrawn, flagged, own] as Punch[] | "loading" | "failed", truncated = false, role = "EMPLOYEE", grants = [] as string[], wide = [] as string[], locale = "en" as "en" | "ar", search = "tab=punches" } = {}) {
    state.role = role
    state.grants = new Set(grants)
    state.wide = new Set(wide)
    state.locale = locale
    state.search = search
    state.keys = []
    state.punches = shows === "loading" ? {}
        : shows === "failed" ? { error: Object.assign(new Error("Request failed"), { info: { error: "Database unavailable" } }) }
            : { data: { data: { punches: shows, truncated, limit: 2000 } } }
    const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
    return renderToStaticMarkup(h(AttendancePage))
}
const panel = (html: string) => html.slice(html.indexOf('<div role="tabpanel"'))
const period = (html: string) => {
    const at = html.indexOf('class="ui-panel ui-period"')
    if (at < 0) return ""
    const end = html.slice(at).search(/<section class/)
    return html.slice(at, end < 0 ? undefined : at + end)
}
const table = (html: string) => {
    const at = html.indexOf('<table class="ui-table">')
    return at < 0 ? "" : html.slice(at, html.indexOf("</table>", at))
}
const row = (html: string, key: string) => {
    const at = table(html).indexOf(`data-key="${key}"`)
    return at < 0 ? "" : table(html).slice(at, table(html).indexOf("</tr>", at))
}
const cards = (html: string) => {
    const at = html.indexOf('<ul class="ui-cards"')
    return at < 0 ? "" : html.slice(at, html.indexOf("</ul>", at))
}
const punchesAsked = () => state.keys.filter(k => k?.startsWith("/api/attendance/punches"))

const TEAM = { grants: ["attendance.view_team", "attendance.correct"], wide: ["attendance.correct"] }

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

describe("the punches' period", () => {
    it("is the month Days is about, picked under the page header and kept in the address, the company's with none", async () => {
        const bar = period(panel(await page()))
        expect(bar).toContain('class="ui-label">Month</label>')
        expect(bar).toMatch(/<option value="10" selected="">October<\/option>/)
        expect(bar).toMatch(/<option value="2026" selected="">2026<\/option>/)
        expect(punchesAsked()).toEqual(["/api/attendance/punches?from=2026-10-01&to=2026-10-31"])
        await page({ search: "tab=punches&year=2026&month=9" })
        expect(punchesAsked()).toEqual(["/api/attendance/punches?from=2026-09-01&to=2026-09-30"])
        expect(panel(await page())).not.toContain('type="date"')
    })

    it("can be one day of the month, picked beside it and kept in the address, named in the page's language", async () => {
        const bar = period(panel(await page({ search: "tab=punches&year=2026&month=10&day=15" })))
        expect(bar).toContain('class="ui-label">Day</label>')
        expect(bar).toContain('<option value="">Every day</option>')
        expect(bar).toMatch(/<option value="15" selected="">Thu 15<\/option>/)
        expect(punchesAsked()).toEqual(["/api/attendance/punches?from=2026-10-15&to=2026-10-15"])
        expect(period(panel(await page({ locale: "ar", search: "tab=punches&year=2026&month=10&day=15" })))).toContain("الخميس، ١٥</option>")
    })

    it("has whose punches beside it, with those whose number is nobody's yet for whoever corrects the company's", async () => {
        const bar = period(panel(await page(TEAM)))
        expect(bar).toContain('class="ui-label">Person</label>')
        expect(bar).toContain('<option value="" selected="">Everyone</option>')
        expect(bar).toContain('<option value="unmatched">With no person yet</option>')
        expect(bar).toContain('<option value="u2">Sami Nabil</option>')
        expect(bar).not.toContain('type="checkbox"')
        expect(period(panel(await page()))).not.toContain(">Person</label>")
    })
})

describe("the punches", () => {
    it("are a list named for the period, a table on computers and a card for each on phones", async () => {
        const html = panel(await page())
        expect(html).toContain('<h2 class="ui-section-title">Punches in October 2026</h2>')
        expect(table(html)).toContain('<caption class="ui-visually-hidden">Punches in October 2026</caption>')
        expect(cards(html)).toMatch(/^<ul class="ui-cards" aria-label="Punches in October 2026">/)
        expect(panel(await page({ search: "tab=punches&day=15" }))).toContain('<h2 class="ui-section-title">Punches on Thursday 15 October</h2>')
    })

    it("show each punch's day and time, in or out, and where it came from", async () => {
        const one = row(panel(await page()), "p1")
        expect(one).toContain('<div class="ui-item-title">Thu 15 Oct, 09:12</div>')
        expect(one).toContain(">In<")
        expect(one).toContain("App, Head office")
        expect(row(panel(await page()), "p2")).toContain("Imported")
    })

    it("say whose each is when the list has other people's, and the number when it's nobody's yet", async () => {
        const html = panel(await page(TEAM))
        expect(row(html, "p1")).toContain('<div class="ui-item-detail">Sami Nabil</div>')
        expect(row(html, "p2")).toContain('<div class="ui-item-detail">Number 117, nobody yet</div>')
    })

    it("mark one that doesn't count with a badge saying why, and one withdrawn with its reason", async () => {
        const html = panel(await page(TEAM))
        expect(row(html, "p4")).toContain('<span class="ui-badge ui-badge-waiting">Flagged</span>')
        // What the badge means, below it, not the badge's word again.
        expect(row(html, "p4")).toContain(en.punch_status_FLAGGED.replace("'", "&#x27;"))
        expect(en.punch_status_FLAGGED).toBe("Doesn't count until someone accepts it.")
        expect(row(html, "p4")).toContain(en.att_flag_OUTSIDE_AREA)
        expect(row(html, "p3")).toContain('<span class="ui-badge ui-badge-neutral">Withdrawn</span>')
        expect(row(html, "p3")).toContain("Typed the wrong day")
        // One that counts needs no badge.
        expect(row(html, "p1")).not.toContain("ui-badge")
    })

    it("are dated and timed in Arabic on the Arabic page", async () => {
        const html = panel(await page({ locale: "ar" }))
        expect(html).toContain(`<h2 class="ui-section-title">${ar.punch_list_title.replace("{period}", "أكتوبر ٢٠٢٦")}</h2>`)
        expect(row(html, "p1")).toContain("١٥ أكتوبر")
        expect(row(html, "p1")).toContain("٠٩:١٢")
    })

    it("offer Withdraw on another's that still counts, to whoever corrects it, and never on one's own", async () => {
        const html = panel(await page(TEAM))
        expect(row(html, "p1")).toMatch(/<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">[^<]*Withdraw<\/button>/)
        expect(row(html, "p3")).not.toContain(">Withdraw</button>")
        expect(row(html, "p5")).not.toContain(">Withdraw</button>")
        expect(panel(await page())).not.toContain(">Withdraw</button>")
    })

    it("say there are none, while they load, and when they didn't, with the server's word and Try again", async () => {
        expect(panel(await page({ shows: [] }))).toContain(`<p class="ui-empty-title">${en.punch_none}</p>`)
        expect(panel(await page({ shows: [], search: "tab=punches&day=15" }))).toContain(`<p class="ui-empty-title">${en.punch_none_day}</p>`)
        expect(panel(await page({ shows: "loading" }))).toContain(`<p class="ui-empty-title">${en.loading}</p>`)
        const failed = panel(await page({ shows: "failed" }))
        expect(failed).toContain(`<p class="ui-empty-title">${en.punch_load_failed.replace("'", "&#x27;")}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })

    it("say when the list is cut short, and how to see the rest", async () => {
        const html = panel(await page({ ...TEAM, truncated: true }))
        expect(html).toContain(en.punch_truncated.replace("{n}", "2,000"))
        expect(en.punch_truncated).toBe("Showing the latest {n} punches only. Pick a day or a person to see the rest.")
    })

    it("are added to from the list's heading, by whoever corrects attendance", async () => {
        expect(panel(await page(TEAM))).toMatch(/<div class="ui-section-head"><h2 class="ui-section-title">Punches in October 2026<\/h2><button type="button" class="ui-btn ui-btn-primary ui-btn-sm">[^<]*Add a punch<\/button><\/div>/)
        expect(panel(await page())).not.toContain("Add a punch")
    })
})

describe("found in the interface audit (PR 150)", () => {
    const SOURCE = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
    const punches = SOURCE.slice(SOURCE.indexOf("// --- Punches"), SOURCE.indexOf("// --- Import"))

    it("says a check-in came from the app, with no dash where it had no place", async () => {
        const one = row(panel(await page({ shows: [punch({ placeName: null })] })), "p1")
        expect(one).toContain("<td>App</td>")
        expect(one).not.toContain("App, —")
    })

    it("names the punch being withdrawn in its dialog: whose, when, and in or out", () => {
        const dialog = punches.slice(punches.indexOf("<Dialog open={withdrawing !== null}"))
        expect(dialog).toContain("<Details items={[")
        expect(dialog).toContain("value: whose(withdrawing)")
        expect(dialog).toContain("value: when(withdrawing)")
        expect(dialog).toContain("value: direction(withdrawing)")
    })

    it("gives a phone card's in or out and where it came from icons of their own, not the notes'", () => {
        expect(punches).toContain("{ icon: ArrowsLeftRightIcon, text: direction(x) }")
        expect(punches).toContain("{ icon: DevicesIcon, text: source(x) }")
    })
})

describe("Punches is on the building blocks", () => {
    const SOURCE = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
    const punches = SOURCE.slice(SOURCE.indexOf("// --- Punches"), SOURCE.indexOf("// --- Import"))

    it("has no hand-made styles, old buttons, old table, spinner or old modal left", () => {
        expect(punches).not.toContain("style={{")
        expect(punches).not.toMatch(/className=\{?['"`](btn|input|label|glass|table)/)
        expect(punches).not.toContain("LoadingSpinner")
        expect(punches).not.toContain("ConfirmModal")
        expect(punches).toContain("<DataList")
        expect(punches).toContain("<PeriodBar>")
    })

    it("withdraws in the building blocks' dialog: why, said under its field, and the danger button that stays while it works", () => {
        expect(punches).toMatch(/<Dialog\s+open=\{withdrawing !== null\}/)
        expect(punches).toContain("t('punch_reason_required')")
        expect(punches).toMatch(/<Button variant="danger"[\s\S]*?>\s*\{t\('punch_withdraw'\)\}\s*<\/Button>/)
        expect(punches).toContain("if (!action.running) setWithdrawing(null)")
    })

    it("keeps the day in the address, beside the month, and asks for whose punches were picked", () => {
        expect(punches).toContain("dayFromAddress(params, year, monthNumber)")
        expect(punches).toContain("who === UNMATCHED ? '&unmatched=1' : who ? `&userId=${encodeURIComponent(who)}` : ''")
    })
})
