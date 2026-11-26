import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { prismaMock } from "./permissions/employee-access.harness"

/**
 * Attendance's Numbers tab and work locations with each person's name in the
 * page's language (LATER_CHANGES_PLAN.md §3.1, step 8j; PR 421): whose each
 * terminal number is, and its person pickers in the page's order; and the
 * people a work location is for, in its row and in its people picker. Each
 * name is in the page's language, or in the one it has while it has only
 * one. On an Arabic page, those with an Arabic name come first, in Arabic
 * order, then the rest as they came.
 */

// The first import of the page and the services takes a while.
vi.setConfig({ testTimeout: 60_000 })

const ui = {
    locale: "en" as "en" | "ar",
    swr: {} as Record<string, unknown>,
}
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: "ADMIN" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
const GRANTS = new Set(["attendance.view_team", "attendance.correct"])
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => GRANTS.has(p), companyWide: (p: string) => GRANTS.has(p), canFor: (p: string) => GRANTS.has(p) }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null, setSelectedCompanyId: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("@/components/PointPicker", () => ({ default: () => null }))
vi.mock("react-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-dom")>(), createPortal: (node: unknown) => node }))
// Each request answered by the start of its address.
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const found = key ? Object.entries(ui.swr).find(([start]) => key.startsWith(start))?.[1] : undefined
        return { data: found, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
    },
    useSWRConfig: () => ({ mutate: async () => {} }),
}))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams("tab=numbers"),
    usePathname: () => "/dashboard/attendance",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

// Made-up people, as the database keeps them.
const SAMI = { firstName: "Sami", lastName: "Nabil", firstNameAr: "سامي", lastNameAr: "نبيل" }
const BOB = { firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null }
// And as the server sends them, by their English: Bob, Hana, Sami.
const PEOPLE = [
    { id: "u3", name: "Bob Brown", nameAr: null, teamLeaderId: null },
    { id: "u1", name: "Hana Saad", nameAr: "هناء سعد", teamLeaderId: null },
    { id: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", teamLeaderId: null },
]
const IN_ARABIC = ["سامي نبيل", "هناء سعد", "Bob Brown"]
const IN_ENGLISH = ["Bob Brown", "Hana Saad", "Sami Nabil"]
const choices = (html: string) => (html.match(/<option value="u\d">[^<]*<\/option>/g) ?? []).map(o => o.replace(/<[^>]+>/g, ""))

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"))
    ui.swr = {}
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("the Numbers tab", () => {
    const CODES = {
        mapped: [
            { id: "m1", code: "101", userId: "u2", name: "Sami Nabil", nameAr: "سامي نبيل" },
            { id: "m2", code: "102", userId: "u3", name: "Bob Brown", nameAr: null },
        ],
        unmatched: [{ code: "117", punches: 3, from: "2026-10-01", to: "2026-10-03" }],
    }
    const page = async (locale: "en" | "ar") => {
        ui.locale = locale
        ui.swr = {
            "/api/attendance/people": { data: { today: "2026-10-31", people: PEOPLE } },
            "/api/attendance/codes": { data: CODES },
        }
        const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
        const html = renderToStaticMarkup(h(AttendancePage))
        return html.slice(html.indexOf('<div role="tabpanel"'))
    }
    const mapped = (html: string) => {
        const at = html.indexOf('<ul class="ui-rows"')
        return at < 0 ? "" : html.slice(at, html.indexOf("</ul>", at))
    }

    it("is given whose each number is in both languages", async () => {
        const asked: { query?: any } = {}
        prismaMock.attendanceCode.findMany = async (query: unknown) => {
            asked.query = query
            return [{ id: "m1", code: "101", userId: "u2", user: SAMI }, { id: "m2", code: "102", userId: "u3", user: BOB }]
        }
        prismaMock.attendancePunch.groupBy = async () => []
        const { AttendancePunchService } = await import("@/lib/services/attendance-punch.service")
        const { mapped } = await AttendancePunchService.codes("c1")
        expect(mapped.map(m => [m.name, m.nameAr])).toEqual([["Sami Nabil", "سامي نبيل"], ["Bob Brown", null]])
        expect(asked.query.select.user.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("says whose each saved number is in the page's language", async () => {
        const html = mapped(await page("ar"))
        expect(html).toContain("سامي نبيل")
        expect(html).toContain("Bob Brown")
        expect(html).not.toContain("Sami Nabil")
        expect(mapped(await page("en"))).toContain("Sami Nabil")
    })

    it("offers the people for a waiting number, and for a new one, in the page's language and order", async () => {
        const html = await page("ar")
        // A waiting number's own picker: nobody has a number yet but Hana.
        const waiting = html.slice(html.indexOf(`aria-label="${ar.punch_person_for.replace("{code}", "117")}"`))
        expect(choices(waiting.slice(0, waiting.indexOf("</select>")))).toEqual(["هناء سعد"])
        // The form's, everyone, for a second number on purpose.
        const form = html.slice(html.indexOf('name="code"'))
        expect(choices(form.slice(0, form.indexOf("</select>")))).toEqual(IN_ARABIC)
        const english = await page("en")
        const formEn = english.slice(english.indexOf('name="code"'))
        expect(choices(formEn.slice(0, formEn.indexOf("</select>")))).toEqual(IN_ENGLISH)
    })

    it("names whose number is being removed in the page's language", () => {
        // The dialog opens from a click, so its code is read.
        const source = readFileSync("app/(dashboard)/dashboard/attendance/NumbersTab.tsx", "utf8")
        expect(source).toContain("{ label: t('punch_person'), value: named(removing) }")
    })
})

describe("work locations", () => {
    const LOCATIONS = {
        locations: [
            { id: "l2", name: "Site B", latitude: 30.1, longitude: 31.3, radiusMeters: 300, officeIpRanges: [], everyone: false, archivedAt: null, userIds: ["u2", "u3"] },
        ],
        people: PEOPLE.map(({ id, name, nameAr }) => ({ id, name, nameAr })),
    }

    it("are given the people they could be for in both languages", async () => {
        const asked: { query?: any } = {}
        prismaMock.workLocation.findMany = async () => []
        prismaMock.user.findMany = async (query: unknown) => { asked.query = query; return [{ id: "u2", ...SAMI }, { id: "u3", ...BOB }] }
        const { AttendanceLocationService } = await import("@/lib/services/attendance-location.service")
        const { people } = await AttendanceLocationService.list("c1")
        expect(people).toEqual([{ id: "u2", name: "Sami Nabil", nameAr: "سامي نبيل" }, { id: "u3", name: "Bob Brown", nameAr: null }])
        expect(asked.query.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("say whom each is for in the page's language", async () => {
        const render = async (locale: "en" | "ar") => {
            ui.locale = locale
            ui.swr = { "/api/attendance/locations": { data: LOCATIONS } }
            const { default: Panel } = await import("@/components/AttendanceLocationsPanel")
            vi.stubGlobal("document", { body: {} })
            return renderToStaticMarkup(h(Panel, { companyId: "c1", readOnly: false }))
        }
        const html = await render("ar")
        expect(html).toContain("سامي نبيل")
        expect(html).toContain("Bob Brown")
        expect(html).not.toContain("Sami Nabil")
        expect(await render("en")).toContain("Sami Nabil")
    })

    it("offer their people to choose in the page's language and order", async () => {
        const { PeopleDialog } = await import("@/components/AttendanceLocationsPanel")
        const dialog = (locale: "en" | "ar") => {
            ui.locale = locale
            vi.stubGlobal("document", { body: {} })
            const html = renderToStaticMarkup(h(PeopleDialog, { location: LOCATIONS.locations[0], people: LOCATIONS.people, busy: false, onClose: () => {}, onSubmit: async () => {} }))
            // Each person's box, by the name beside it.
            return (html.match(/<label class="ui-choice"><input type="checkbox"[^>]*\/><bdi>[^<]*<\/bdi>/g) ?? []).map(x => x.replace(/<[^>]+>/g, ""))
        }
        expect(dialog("ar")).toEqual(IN_ARABIC)
        expect(dialog("en")).toEqual(IN_ENGLISH)
    })
})
