import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { withGrants } from "@/lib/permissions/test-actors"
import { encodeGrants } from "@/lib/permissions/grants"
import { en } from "./translations/en"

/**
 * The Attendance settings tab asks only for what it will be given
 * (FIRST_CHANGES_PLAN.md §5, PR 361): the places people check in at for a
 * company holding the Mobile App add-on, and Fingerprint terminals for a
 * company holding the Terminals add-on, to whoever may set them up. It asked
 * for both on every company, and hid what was refused, so the browser logged
 * the refusal. The tab's calendar now says which it shows. All names are made
 * up.
 */

type Exposure = {
    id: string; adminSettingsEnabled: boolean; adminSettingsTabs: string[]; terminalsSetupByCompany: boolean
    package: { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals: boolean; hasAttendanceMobile: boolean; hasClientPortal: boolean }
}
const state = {
    session: null as any,
    company: null as Exposure | null,
    asked: [] as string[],
    swr: {} as Record<string, { data?: unknown }>,
}

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/services/company.service", () => ({ CompanyService: { settingsExposure: async () => state.company } }))
vi.mock("@/lib/services/attendance-calendar.service", () => ({
    AttendanceCalendarService: { today: async () => "2026-11-21", calendar: async () => ({ today: "2026-11-21" }) },
}))
vi.mock("@/lib/services/attendance-agent.service", () => ({ AttendanceAgentService: { list: async () => [] } }))
vi.mock("@/lib/services/attendance-location.service", () => ({ AttendanceLocationService: { list: async () => ({ locations: [], people: [] }) } }))

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/settings",
    useSearchParams: () => new URLSearchParams("tab=attendance"),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: "ADMIN" } } }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => en[key as keyof typeof en] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("@/components/PointPicker", () => ({ default: () => null }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
// Every request the tab makes, as it makes it.
vi.mock("swr", () => {
    const useSWR = (key: string | null) => {
        if (key) state.asked.push(key)
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    }
    return { default: useSWR, useSWRConfig: () => ({ mutate: async () => {} }) }
})

const PACKAGES = {
    terminals: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: false, hasClientPortal: false },
    mobile: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: false, hasAttendanceMobile: true, hasClientPortal: false },
    both: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true, hasClientPortal: false },
}
const company = (pkg: keyof typeof PACKAGES, terminalsSetupByCompany: boolean): Exposure => ({
    id: "c1", adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], terminalsSetupByCompany, package: PACKAGES[pkg],
})
const person = (grants: Record<string, string>) => ({ id: "p1", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(grants as any) })
const ACTORS = {
    "the Super Admin": withGrants({ id: "sa1", role: "SUPER_ADMIN" }),
    "the company's Admin": withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }),
    "someone who sets terminals up": person({ "attendance.manage_terminals": "COMPANY", "settings.view": "COMPANY" }),
    "someone who only sees settings": person({ "settings.view": "COMPANY" }),
}

const ROUTES = {
    calendar: () => import("@/app/api/attendance/calendar/route"),
    agents: () => import("@/app/api/attendance/agents/route"),
    locations: () => import("@/app/api/attendance/locations/route"),
}
const get = async (path: keyof typeof ROUTES) => {
    const route = await ROUTES[path]()
    return route.GET(new Request(`https://nizmo.test/api/attendance/${path}?companyId=c1`))
}

describe("the tab's calendar says which add-ons' sections it shows", () => {
    beforeEach(() => { state.session = null; state.company = null })

    it("the places for a company holding the Mobile App add-on, and terminals for one holding Terminals, to whoever may set them up", async () => {
        const sections = async (who: keyof typeof ACTORS, c: Exposure) => {
            Object.assign(state, { session: { user: ACTORS[who] }, company: c })
            const res = await get("calendar")
            expect(res.status, who).toBe(200)
            return (await res.json()).data.sections
        }
        expect(await sections("the company's Admin", company("terminals", true))).toEqual({ terminals: true, mobileApp: false })
        expect(await sections("the company's Admin", company("mobile", true))).toEqual({ terminals: false, mobileApp: true })
        expect(await sections("the company's Admin", company("both", true))).toEqual({ terminals: true, mobileApp: true })
        // The Super Admin's switch off: only the Super Admin sets them up.
        expect(await sections("the company's Admin", company("both", false))).toEqual({ terminals: false, mobileApp: true })
        expect(await sections("the Super Admin", company("both", false))).toEqual({ terminals: true, mobileApp: true })
        expect(await sections("someone who only sees settings", company("both", true))).toEqual({ terminals: false, mobileApp: true })
    })

    it("as the sections' own routes answer, for everyone who sees the tab", async () => {
        let seen = 0, terminals = 0, places = 0
        for (const [who, actor] of Object.entries(ACTORS)) {
            for (const pkg of Object.keys(PACKAGES) as (keyof typeof PACKAGES)[]) {
                for (const setup of [true, false]) {
                    Object.assign(state, { session: { user: actor }, company: company(pkg, setup) })
                    const calendar = await get("calendar")
                    if (calendar.status !== 200) continue
                    seen++
                    const { sections } = (await calendar.json()).data
                    const at = `${who}, ${pkg}, set up by the company ${setup}`
                    expect((await get("agents")).status === 200, at).toBe(sections.terminals)
                    expect((await get("locations")).status === 200, at).toBe(sections.mobileApp)
                    if (sections.terminals) terminals++
                    if (sections.mobileApp) places++
                }
            }
        }
        // Both shown and not shown, for each.
        expect(seen).toBe(24)
        expect(terminals).toBeGreaterThan(0)
        expect(terminals).toBeLessThan(seen)
        expect(places).toBeGreaterThan(0)
        expect(places).toBeLessThan(seen)
    })
})

const CALENDAR_KEY = "/api/attendance/calendar?companyId=c1"
const AGENTS = "/api/attendance/agents?companyId=c1"
const PLACES = "/api/attendance/locations?companyId=c1"
const calendar = (sections: { terminals: boolean; mobileApp: boolean }) => ({
    today: "2026-11-21", companyWorkWeek: [0, 1, 2, 3, 4], companyWorkWeeks: [], schedules: [], defaults: [], assignments: [], people: [],
    holidays: { year: 2026, public: [], own: [] }, canEdit: true, sections,
})

async function tab(sections: { terminals: boolean; mobileApp: boolean }) {
    Object.assign(state, { asked: [], swr: { [CALENDAR_KEY]: { data: { data: calendar(sections) } } } })
    const { default: Card } = await import("@/components/CompanyAttendanceCard")
    vi.stubGlobal("document", { body: {} })
    try {
        renderToStaticMarkup(h(Card, { companyId: "c1" }))
    } finally {
        vi.unstubAllGlobals()
    }
    return state.asked
}

describe("the tab asks", () => {
    it("for the places only where the package holds the Mobile App add-on", async () => {
        expect(await tab({ terminals: true, mobileApp: false })).not.toContain(PLACES)
        expect(await tab({ terminals: true, mobileApp: true })).toContain(PLACES)
    })

    it("for Fingerprint terminals only where it shows them", async () => {
        expect(await tab({ terminals: false, mobileApp: true })).not.toContain(AGENTS)
        expect(await tab({ terminals: true, mobileApp: true })).toContain(AGENTS)
    })

    it("for neither on a company it shows neither, and for the rest of the tab as before", async () => {
        const asked = await tab({ terminals: false, mobileApp: false })
        expect(asked.filter(k => k === AGENTS || k === PLACES)).toEqual([])
        for (const key of ["/api/attendance/payroll-from?companyId=c1", "/api/attendance/policy?companyId=c1", "/api/attendance/face/legal?companyId=c1"]) {
            expect(asked).toContain(key)
        }
    })
})
