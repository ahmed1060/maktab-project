import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"

/**
 * Attendance on the building blocks, its frame first (UI_PLAN.md §5 step 5,
 * part 1): the page header, the tabs, and what the page says while it loads,
 * when it can't, and before a Super Admin opens a company. What each tab
 * holds moves in the parts after.
 */

const state = {
    role: "ADMIN",
    sessionStatus: "authenticated" as "authenticated" | "loading",
    grants: new Set<string>(),
    wide: new Set<string>(),
    keys: [] as (string | null)[],
    people: {} as { data?: unknown; error?: unknown },
    search: "",
    /** The company in view, from the top bar's switcher; null is All companies. */
    company: null as string | null,
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.sessionStatus === "loading" ? null : { user: { id: "u1", role: state.role } }, status: state.sessionStatus }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => en[key as keyof typeof en] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/HeaderContext", () => ({ useHeader: () => ({ setTitle: () => {}, setSubtitle: () => {} }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p), companyWide: (p: string) => state.wide.has(p) }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        // The frame's one question is the company's date; each tab's own stay unanswered here.
        return key?.startsWith("/api/attendance/people") ? { ...idle, ...state.people } : idle
    },
}))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company, setSelectedCompanyId: () => {} }) }))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(state.search),
    usePathname: () => "/dashboard/attendance",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

const today = { data: { data: { today: "2026-10-15", people: [] } } }

async function page({ role = "ADMIN", grants = [] as string[], wide = [] as string[], people = today as typeof state.people | "loading" | "failed", search = "", sessionStatus = "authenticated" as "authenticated" | "loading", company = null as string | null } = {}) {
    state.company = company
    state.role = role
    state.grants = new Set(grants)
    state.wide = new Set(wide)
    state.search = search
    state.sessionStatus = sessionStatus
    state.keys = []
    state.people = people === "loading" ? {} : people === "failed" ? { error: Object.assign(new Error("Request failed"), { info: { error: "Database unavailable" } }) } : people
    const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
    return renderToStaticMarkup(h(AttendancePage))
}
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
const tabs = (html: string) => {
    const at = html.indexOf('role="tablist"')
    return at < 0 ? "" : html.slice(at, html.indexOf("</div>", at))
}
const tabNames = (html: string) => [...tabs(html).matchAll(/role="tab"[^>]*>([^<]+)</g)].map(m => m[1])

const EVERYTHING = { grants: ["attendance.view_team"], wide: ["attendance.approve_face", "attendance.correct"] }

describe("Attendance's page header", () => {
    it("names the page and says what it shows", async () => {
        const top = header(await page())
        expect(top).toContain(`<h1 class="ui-page-title">${en.attendance_title}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${en.punch_page_hint}</p>`)
    })
})

describe("Attendance's tabs", () => {
    it("are the building blocks' tabs, one for each thing this person may see", async () => {
        const html = await page(EVERYTHING)
        expect(tabs(html)).toMatch(/^role="tablist" aria-label="Attendance" class="ui-tabs">/)
        expect(tabNames(html)).toEqual([en.exc_tab, en.day_tab_days, en.punch_tab_punches, en.req_tab, en.face_tab, en.punch_tab_import, en.punch_tab_numbers])
        // Somebody who sees only their own has their days, punches and requests.
        expect(tabNames(await page())).toEqual([en.day_tab_days, en.punch_tab_punches, en.req_tab])
    })

    it("show the tab the address names, the first they have when it names none they may see", async () => {
        const picked = tabs(await page({ ...EVERYTHING, search: "tab=punches" }))
        expect(picked).toMatch(/aria-selected="true"[^>]*>Punches</)
        expect(tabs(await page({ search: "tab=import" }))).toMatch(/aria-selected="true"[^>]*>Days</)
    })

    it("hold what the tab shows in a panel named by the tab", async () => {
        const html = await page({ search: "tab=days" })
        expect(html).toMatch(/<button type="button" role="tab" id="attendance-tab-days"[^>]*aria-controls="attendance-panel"/)
        expect(html).toContain('<div role="tabpanel" id="attendance-panel" aria-labelledby="attendance-tab-days">')
    })
})

describe("what Attendance says before its tabs", () => {
    it("says while it finds out who's asking and the company's date", async () => {
        for (const html of [await page({ sessionStatus: "loading" }), await page({ people: "loading" })]) {
            expect(html).toContain(`<div class="ui-panel" role="status"><div class="ui-empty">`)
            expect(html).toContain(`<p class="ui-empty-title">${en.loading}</p>`)
        }
    })

    it("says when it can't have the company's date, with the server's word and Try again", async () => {
        const html = await page({ people: "failed" })
        expect(html).toContain(`<p class="ui-empty-title">${en.attendance_load_failed.replace("'", "&#x27;")}</p>`)
        expect(html).toContain("Database unavailable")
        expect(html).toContain(">Try again</button>")
        expect(html).not.toContain('role="tablist"')
    })

    it("asks a Super Admin to pick a company at the top, and asks the server nothing until then", async () => {
        const html = await page({ role: "SUPER_ADMIN" })
        expect(html).toContain(`<p class="ui-empty-title">${en.punch_pick_company}</p>`)
        expect(en.punch_pick_company).toBe("Pick a company at the top to see its attendance.")
        expect(state.keys.filter(Boolean)).toEqual([])
    })
})

describe("a Super Admin's company (part 2)", () => {
    it("is the company in view, picked in the top bar as on every other page (DESIGN.md §5.3)", async () => {
        await page({ role: "SUPER_ADMIN", company: "delta" })
        expect(state.keys).toContain("/api/attendance/people?companyId=delta&")
    })

    it("is the one a link names while it's in the address, so nothing is asked about the last one first", async () => {
        // The top bar puts it in view and takes it out of the address; until
        // then the page already asks about the right company.
        await page({ role: "SUPER_ADMIN", company: "nile", search: "companyId=delta&tab=face" })
        expect(state.keys).toContain("/api/attendance/people?companyId=delta&")
        expect(state.keys).not.toContain("/api/attendance/people?companyId=nile&")
    })

    it("is nobody's for anyone else, whatever the address says", async () => {
        await page({ company: "delta", search: "companyId=delta" })
        expect(state.keys).toContain("/api/attendance/people?")
    })
})

describe("Attendance's frame is on the building blocks", () => {
    const SOURCE = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
    const frame = SOURCE.slice(SOURCE.indexOf("export default function AttendancePage"), SOURCE.indexOf("// --- Days"))

    it("has no hand-made styles, old buttons or old header left", () => {
        expect(frame).not.toContain("style={{")
        expect(frame).not.toMatch(/className=\{?['"`]btn/)
        expect(frame).not.toContain("LoadingSpinner")
        expect(SOURCE).not.toContain("useHeader")
    })
})
