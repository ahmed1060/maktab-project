import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Attendance's Exceptions on the building blocks (UI_PLAN.md §5 step 5, part
 * 5): the month Days and Punches are about, and a day of it, under the page
 * header (DESIGN.md §5.3); what waits elsewhere as tiles that open it; the
 * kinds as the building blocks' tabs, kept in the address; each kind as a
 * list (§5.4); and excusing, or turning down overtime, in their dialog.
 */

const state = {
    locale: "en" as "en" | "ar",
    keys: [] as (string | null)[],
    exceptions: {} as { data?: unknown; error?: unknown },
    search: "tab=exceptions",
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
const TEAM = new Set(["attendance.view_team", "attendance.correct", "attendance.approve_overtime"])
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => TEAM.has(p), companyWide: (p: string) => TEAM.has(p), canFor: (p: string) => TEAM.has(p) }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null, setSelectedCompanyId: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (key?.startsWith("/api/attendance/people")) {
            return { ...idle, data: { data: { today: "2026-10-31", people: [{ id: "u1", name: "Hana Saad", teamLeaderId: null }, { id: "u2", name: "Sami Nabil", teamLeaderId: null }] } } }
        }
        if (key?.startsWith("/api/attendance/exceptions")) return { ...idle, ...state.exceptions }
        return idle
    },
}))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(state.search),
    usePathname: () => "/dashboard/attendance",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

type Row = Record<string, unknown>
const none = { minutes: 0, days: 0, occurrence: 0, note: null }
const row = (fields: Row = {}): Row => ({
    id: "d1", userId: "u2", name: "Sami Nabil", teamLeaderId: null, date: "2026-10-15", status: "PRESENT",
    firstIn: "2026-10-15T09:12:00", lastOut: "2026-10-15T17:00:00", lateMinutes: 12, earlyLeaveMinutes: 0, overtimeMinutes: 0,
    deductionMinor: 12500, breakdown: { lateness: { minutes: 12, days: 0.25, occurrence: 3, note: "ESCALATED" }, earlyLeave: none, absenceDays: 0 },
    expectedEndMinutes: 1020,
    ...fields,
})
const own = row({ id: "d9", userId: "u1", name: "Hana Saad", date: "2026-10-12" })
const DATA = {
    late: [row(), own], early: [], absent: [row({ id: "d2", date: "2026-10-16", status: "ABSENT", firstIn: null, lastOut: null, lateMinutes: 0, deductionMinor: 50000, breakdown: { lateness: none, earlyLeave: none, absenceDays: 1 } })],
    incomplete: [row({ id: "d3", date: "2026-10-19", status: "INCOMPLETE", lastOut: null, lateMinutes: 0 })],
    overtime: [row({ id: "d4", date: "2026-10-22", overtimeMinutes: 60, lateMinutes: 0, firstIn: "2026-10-22T10:00:00", lastOut: "2026-10-22T18:00:00" })],
    decided: [{ id: "x1", userId: "u2", name: "Sami Nabil", teamLeaderId: null, date: "2026-10-14", subject: "LATENESS", outcome: "EXCUSED", reason: "Bus strike" }],
    counts: { late: 2, early: 0, absent: 1, incomplete: 1, overtime: 1, permissions: 2, missing: 1, unmatched: 2, faceOverdue: 0 },
    capped: { absent: true },
}

async function page({ shows = DATA as typeof DATA | "loading" | "failed", locale = "en" as "en" | "ar", search = "tab=exceptions" } = {}) {
    state.locale = locale
    state.search = search
    state.keys = []
    state.exceptions = shows === "loading" ? {}
        : shows === "failed" ? { error: Object.assign(new Error("Request failed"), { info: { error: "Database unavailable" } }) }
            : { data: { data: shows } }
    const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
    return renderToStaticMarkup(h(AttendancePage))
}
const panel = (html: string) => html.slice(html.indexOf('<div role="tabpanel" id="attendance-panel"'))
const period = (html: string) => {
    const at = html.indexOf('class="ui-panel ui-period"')
    return at < 0 ? "" : html.slice(at, html.indexOf("</div></div>", html.lastIndexOf("</select>")) )
}
const kinds = (html: string) => {
    // The kinds' tablist, inside the page's own.
    const at = html.indexOf('aria-label=', html.indexOf('role="tablist"'))
    return at < 0 ? "" : html.slice(at, html.indexOf("</div>", at))
}
const tiles = (html: string) => {
    const at = html.indexOf('<dl class="ui-tiles">')
    return at < 0 ? "" : html.slice(at, html.indexOf("</dl>", at))
}
const table = (html: string) => {
    const at = html.indexOf('<table class="ui-table">')
    return at < 0 ? "" : html.slice(at, html.indexOf("</table>", at))
}
const row_ = (html: string, key: string) => {
    const at = table(html).indexOf(`data-key="${key}"`)
    return at < 0 ? "" : table(html).slice(at, table(html).indexOf("</tr>", at))
}
const asked = () => state.keys.filter(k => k?.startsWith("/api/attendance/exceptions"))

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

describe("the exceptions' period", () => {
    it("is the month the other tabs are about, picked under the page header, and yesterday's with none, up to yesterday", async () => {
        // The company's today is 31 October, so yesterday is the 30th: only days that are over have exceptions.
        const bar = period(panel(await page()))
        expect(bar).toContain('class="ui-label">Month</label>')
        expect(bar).toMatch(/<option value="10" selected="">October<\/option>/)
        expect(asked()).toEqual(["/api/attendance/exceptions?from=2026-10-01&to=2026-10-30"])
        await page({ search: "tab=exceptions&year=2026&month=9" })
        expect(asked()).toEqual(["/api/attendance/exceptions?from=2026-09-01&to=2026-09-30"])
        expect(panel(await page())).not.toContain('type="date"')
    })

    it("can be one day of it, the days not over yet listed but not picked", async () => {
        const bar = period(panel(await page({ search: "tab=exceptions&year=2026&month=10&day=15" })))
        expect(bar).toMatch(/<option value="15" selected="">Thu 15<\/option>/)
        expect(bar).toContain('<option value="31" disabled="">Sat 31</option>')
        expect(asked()).toEqual(["/api/attendance/exceptions?from=2026-10-15&to=2026-10-15"])
    })

    it("asks nothing for a month or a day not over yet, and says so", async () => {
        const html = panel(await page({ search: "tab=exceptions&year=2026&month=11" }))
        expect(asked()).toEqual([])
        expect(html).toContain(`<p class="ui-empty-title">${en.exc_not_over}</p>`)
        await page({ search: "tab=exceptions&year=2026&month=10&day=31" })
        expect(asked()).toEqual([])
    })
})

describe("what waits elsewhere", () => {
    it("is a tile for each that waits, opening where it's decided, the month kept", async () => {
        const top = tiles(panel(await page({ search: "tab=exceptions&year=2026&month=10" })))
        expect(top).toContain('<a class="ui-tile-link" href="/dashboard/requests?tab=review">Requests to decide</a></dt><dd>3</dd>')
        expect(top).toContain('<a class="ui-tile-link" href="/dashboard/attendance?tab=numbers&amp;year=2026&amp;month=10">Punches with no person</a></dt><dd>2</dd>')
        // Nothing overdue, no tile.
        expect(top).not.toContain("Face checks overdue")
        expect(panel(await page())).not.toMatch(/<button[^>]*>[^<]*(Requests waiting|Punches with no person)/)
    })
})

describe("the kinds", () => {
    it("are the building blocks' tabs, each with how many, a plus where there are more than shown", async () => {
        const list = kinds(panel(await page()))
        expect(list).toMatch(/^aria-label="What needs a decision" class="ui-tabs">/)
        expect(list).toContain(">Late / left early (2)</button>")
        expect(list).toContain(">Absent (1+)</button>")
        expect(list).toContain(">Decided (1)</button>")
        expect(list).toMatch(/aria-selected="true"[^>]*>Late \/ left early/)
    })

    it("count in the page's digits on the Arabic page", async () => {
        expect(kinds(panel(await page({ locale: "ar" })))).toContain(`>${ar.exc_tab_late} (٢)</button>`)
    })

    it("open on the one the address names, so a reload or a link keeps it", async () => {
        expect(kinds(panel(await page({ search: "tab=exceptions&kind=overtime" })))).toMatch(/aria-selected="true"[^>]*>Overtime/)
        expect(kinds(panel(await page({ search: "tab=exceptions&kind=nonsense" })))).toMatch(/aria-selected="true"[^>]*>Late \/ left early/)
    })
})

describe("each kind's list", () => {
    it("is a list of the days, a table on computers and a card for each on phones, each day dated and whose", async () => {
        const html = panel(await page())
        expect(table(html)).toContain('<caption class="ui-visually-hidden">Late / left early</caption>')
        expect(html).toContain('<ul class="ui-cards" aria-label="Late / left early">')
        const one = row_(html, "d1:LATENESS")
        expect(one).toContain('<div class="ui-item-title">Thu 15 Oct</div><div class="ui-item-detail">Sami Nabil</div>')
        expect(one).toContain("12 min late")
        expect(one).toContain("<bdi>09:12–17:00</bdi>")
        expect(one).toContain("repeated, charged more (3)")
        expect(one).toContain("0.25 days")
    })

    it("offers Excuse and Accept on another's day to whoever corrects it, and nothing on one's own", async () => {
        const html = panel(await page())
        expect(row_(html, "d1:LATENESS")).toMatch(/<button type="button" class="ui-btn ui-btn-primary ui-btn-sm">Excuse<\/button><button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">Accept<\/button>/)
        expect(row_(html, "d9:LATENESS")).not.toContain("<button")
    })

    it("for absences gives what the day costs", async () => {
        const one = row_(panel(await page({ search: "tab=exceptions&kind=absent" })), "d2")
        expect(one).toContain("<bdi>500.00</bdi>")
        expect(one).toContain(">Excuse</button>")
    })

    it("for a missing punch gives the one there is, and Add a punch", async () => {
        const one = row_(panel(await page({ search: "tab=exceptions&kind=incomplete" })), "d3")
        expect(one).toContain("<bdi>09:12</bdi>")
        expect(one).toContain(en.day_unpriced_incomplete)
        expect(one).toContain(">Add a punch</button>")
    })

    it("for overtime gives the minutes, with Approve and Reject", async () => {
        const one = row_(panel(await page({ search: "tab=exceptions&kind=overtime" })), "d4")
        expect(one).toContain("60 min")
        expect(one).toMatch(/>Approve<\/button><button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">Reject<\/button>/)
    })

    it("for the decided gives the decision as a badge, its reason, and Undo", async () => {
        const one = row_(panel(await page({ search: "tab=exceptions&kind=decided" })), "x1")
        expect(one).toContain('<span class="ui-badge ui-badge-good">Excused</span>')
        expect(one).toContain("Bus strike")
        expect(one).toContain(">Undo</button>")
    })

    it("says there's nothing to decide, while it loads, and when it didn't, with the server's word and Try again", async () => {
        expect(panel(await page({ shows: { ...DATA, late: [], early: [] } }))).toContain(`<p class="ui-empty-title">${en.exc_none}</p>`)
        expect(panel(await page({ shows: "loading" }))).toContain(`<p class="ui-empty-title">${en.loading}</p>`)
        const failed = panel(await page({ shows: "failed" }))
        expect(failed).toContain(`<p class="ui-empty-title">${en.exc_load_failed.replace("'", "&#x27;")}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })
})

describe("found in the interface audit (PR 151)", () => {
    it("gives no times for a day with no punch, where it said —–—", async () => {
        const noPunch = { ...DATA, overtime: [row({ id: "d5", date: "2026-10-29", overtimeMinutes: 45, lateMinutes: 0, firstIn: null, lastOut: null })] }
        const one = row_(panel(await page({ shows: noPunch, search: "tab=exceptions&kind=overtime" })), "d5")
        expect(one).toContain("45 min")
        expect(one).not.toContain("—–—")
        expect(one).not.toContain("<bdi>")
    })

    it("names one day's list as on that day, not in it", async () => {
        expect(panel(await page({ search: "tab=exceptions&year=2026&month=10&day=15" }))).toContain('<h2 class="ui-section-title">To decide on Thursday 15 October</h2>')
        expect(panel(await page())).toContain('<h2 class="ui-section-title">To decide in October 2026</h2>')
    })
})

describe("Exceptions is on the building blocks", () => {
    const SOURCE = readFileSync("app/(dashboard)/dashboard/attendance/ExceptionsTab.tsx", "utf8")

    it("has no hand-made styles, old buttons, old tables, spinner or old modal left", () => {
        expect(SOURCE).not.toContain("style={")
        expect(SOURCE).not.toMatch(/className=\{?['"`](btn|input|label|glass|table)/)
        expect(SOURCE).not.toContain("LoadingSpinner")
        expect(SOURCE).not.toContain("ConfirmModal")
        expect(SOURCE).toContain("<DataList")
        expect(SOURCE).toContain("<PeriodBar>")
    })

    it("excuses in the building blocks' dialog: why, said under its field when it's missing", () => {
        expect(SOURCE).toMatch(/<Dialog\s+open=\{excusing !== null\}/)
        expect(SOURCE).toContain("t('punch_reason_required')")
    })

    it("turns overtime down in the building blocks' dialog, the reason its own choice, the danger button its confirm", () => {
        expect(SOURCE).toMatch(/<Dialog\s+open=\{rejecting !== null\}/)
        expect(SOURCE).toMatch(/<Button variant="danger"[\s\S]*?>\s*\{t\('req_reject'\)\}\s*<\/Button>/)
    })

    it("takes the month and day from the address, and the kind too", () => {
        expect(SOURCE).toContain("useMonthInAddress(today, yesterday)")
        expect(SOURCE).toContain("useDayInAddress(period, yesterday)")
        expect(SOURCE).toContain("params.get('kind')")
    })
})
