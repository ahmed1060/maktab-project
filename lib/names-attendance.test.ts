import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { prismaMock } from "./permissions/employee-access.harness"

/**
 * Attendance's days and punches with each person's name in the page's
 * language (LATER_CHANGES_PLAN.md §3.1, step 8h; PR 419): the people its
 * tabs' Person select lists, in the page's order; whose each day and each
 * punch is; and the people Add punch offers. Each name is in the page's
 * language, or in the one it has while it has only one. On an Arabic page,
 * those with an Arabic name come first, in Arabic order, then the rest as
 * they came.
 */

// The first import of the page and the services takes a while.
vi.setConfig({ testTimeout: 60_000 })

const ui = {
    locale: "en" as "en" | "ar",
    grants: new Set<string>(),
    wide: new Set<string>(),
    search: "tab=days",
    days: [] as unknown[],
    punches: [] as unknown[],
}
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: "ADMIN" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: (p: string) => ui.grants.has(p), companyWide: (p: string) => ui.wide.has(p), canFor: (p: string) => ui.grants.has(p) || ui.wide.has(p) }),
}))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null, setSelectedCompanyId: () => {} }) }))
// The people as the server sends them, by their English: Bob, Hana, Sami.
const PEOPLE = [
    { id: "u3", name: "Bob Brown", nameAr: null, teamLeaderId: null },
    { id: "u1", name: "Hana Saad", nameAr: "هناء سعد", teamLeaderId: null },
    { id: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", teamLeaderId: null },
]
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (key?.startsWith("/api/attendance/people")) return { ...idle, data: { data: { today: "2026-10-31", people: PEOPLE } } }
        if (key?.startsWith("/api/attendance/days")) return { ...idle, data: { data: { days: ui.days, truncated: false, limit: 2000, rules: null } } }
        if (key?.startsWith("/api/attendance/punches")) return { ...idle, data: { data: { punches: ui.punches, truncated: false, limit: 2000 } } }
        return idle
    },
}))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(ui.search),
    usePathname: () => "/dashboard/attendance",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

// Made-up people, as the database keeps them.
const SAMI = { firstName: "Sami", lastName: "Nabil", firstNameAr: "سامي", lastNameAr: "نبيل" }
const BOB = { firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null }

const none = { minutes: 0, days: 0, occurrence: 0, note: null }
const day = (fields: Record<string, unknown>) => ({
    id: "d1", userId: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", date: "2026-10-15", status: "PRESENT",
    firstIn: "2026-10-15T09:00:00", lastOut: "2026-10-15T17:00:00", workedMinutes: 480,
    lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, excusedMinutes: 0, expectedStartMinutes: 540, expectedEndMinutes: 1020,
    deductionDays: 0, deductionMinor: null, overtimeStatus: "NONE", overtimeMinor: null, missionAllowanceMinor: null,
    breakdown: { lateness: none, earlyLeave: none, absenceDays: 0, unpriced: null, holiday: null },
    ...fields,
})
const punch = (fields: Record<string, unknown>) => ({
    id: "p1", userId: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", hardwareUserId: null, source: "MANUAL", at: "2026-10-15T09:00:00",
    direction: "IN", note: null, deviceName: null, placeName: null, status: "ACCEPTED", flagReasons: [], voidedAt: null, voidReason: null,
    ...fields,
})

async function page(tab: "days" | "punches", locale: "en" | "ar") {
    ui.locale = locale
    ui.search = `tab=${tab}`
    ui.grants = new Set(["attendance.view_team", "attendance.correct"])
    ui.wide = new Set(["attendance.correct"])
    const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
    const html = renderToStaticMarkup(h(AttendancePage))
    return html.slice(html.indexOf('<div role="tabpanel"'))
}
const personSelect = (html: string) => {
    const at = html.indexOf('class="ui-label">' + (ui.locale === "ar" ? ar.punch_person : en.punch_person) + "</label>")
    return at < 0 ? "" : html.slice(at, html.indexOf("</select>", at))
}
const choices = (select: string) => (select.match(/<option value="u\d">[^<]*<\/option>/g) ?? []).map(o => o.replace(/<[^>]+>/g, ""))
const table = (html: string) => {
    const at = html.indexOf('<table class="ui-table">')
    return at < 0 ? "" : html.slice(at, html.indexOf("</table>", at))
}
const cards = (html: string) => {
    const at = html.indexOf('<ul class="ui-cards"')
    return at < 0 ? "" : html.slice(at, html.indexOf("</ul>", at))
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"))
    ui.days = []
    ui.punches = []
})
afterEach(() => { vi.useRealTimers() })

describe("the people attendance lists", () => {
    it("are given in both languages, Arabic where they have it", async () => {
        const asked: { query?: any } = {}
        prismaMock.user.findMany = async (query: unknown) => { asked.query = query; return [{ id: "u2", teamLeaderId: null, ...SAMI }, { id: "u3", teamLeaderId: "u2", ...BOB }] }
        const { AttendancePunchService } = await import("@/lib/services/attendance-punch.service")
        expect(await AttendancePunchService.people("c1", { kind: "COMPANY" })).toEqual([
            { id: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", teamLeaderId: null },
            { id: "u3", name: "Bob Brown", nameAr: null, teamLeaderId: "u2" },
        ])
        expect(asked.query.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("are offered in the Days tab's Person select, in the page's language and order", async () => {
        expect(choices(personSelect(await page("days", "ar")))).toEqual(["سامي نبيل", "هناء سعد", "Bob Brown"])
        expect(choices(personSelect(await page("days", "en")))).toEqual(["Bob Brown", "Hana Saad", "Sami Nabil"])
    })

    it("and in the Punches tab's", async () => {
        expect(choices(personSelect(await page("punches", "ar")))).toEqual(["سامي نبيل", "هناء سعد", "Bob Brown"])
        expect(choices(personSelect(await page("punches", "en")))).toEqual(["Bob Brown", "Hana Saad", "Sami Nabil"])
    })

    it("and by Add punch, in the page's language and order, as the server or another tab gives them", async () => {
        const { AddPunchForm } = await import("@/app/(dashboard)/dashboard/attendance/AddPunchDialog")
        const form = (locale: "en" | "ar") => {
            ui.locale = locale
            const html = renderToStaticMarkup(h(AddPunchForm, { companyId: null, today: "2026-10-31", people: PEOPLE, onCancel: () => {}, onAdded: () => {} }))
            return choices(html.slice(html.indexOf('name="person"')))
        }
        expect(form("ar")).toEqual(["سامي نبيل", "هناء سعد", "Bob Brown"])
        expect(form("en")).toEqual(["Bob Brown", "Hana Saad", "Sami Nabil"])
    })
})

describe("the days", () => {
    it("are given whose each is in both languages", async () => {
        const asked: { query?: any } = {}
        prismaMock.attendanceDay.findMany = async (query: unknown) => {
            asked.query = query
            const row = { id: "d1", userId: "u2", date: new Date("2026-10-15T00:00:00Z"), firstInAt: null, lastOutAt: null, deductionDays: 0 }
            return [{ ...row, user: { ...SAMI, teamLeaderId: null } }, { ...row, id: "d2", userId: "u3", user: { ...BOB, teamLeaderId: null } }]
        }
        const { AttendanceEngineService } = await import("@/lib/services/attendance-engine.service")
        const days = await AttendanceEngineService.days("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "COMPANY" })
        expect(days.map(d => [d.name, d.nameAr])).toEqual([["Sami Nabil", "سامي نبيل"], ["Bob Brown", null]])
        expect(asked.query.include.user.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("say whose each is in the page's language, on computers and on phones", async () => {
        ui.days = [day({}), day({ id: "d2", userId: "u3", name: "Bob Brown", nameAr: null })]
        const html = await page("days", "ar")
        expect(table(html)).toContain('<div class="ui-item-detail">سامي نبيل</div>')
        expect(cards(html)).toContain("سامي نبيل")
        expect(html).not.toContain("Sami Nabil")
        // One with no Arabic name, in English.
        expect(table(html)).toContain('<div class="ui-item-detail">Bob Brown</div>')
        const english = await page("days", "en")
        expect(table(english)).toContain('<div class="ui-item-detail">Sami Nabil</div>')
        expect(cards(english)).toContain("Sami Nabil")
        expect(english).not.toContain("سامي نبيل")
    })
})

describe("the punches", () => {
    it("are given whose each is in both languages", async () => {
        const asked: { query?: any } = {}
        prismaMock.attendancePunch.findMany = async (query: unknown) => {
            asked.query = query
            const row = { id: "p1", userId: "u2", hardwareUserId: null, source: "MANUAL", punchAtLocal: new Date("2026-10-15T09:00:00Z"), device: null, workLocation: null }
            return [{ ...row, user: SAMI }, { ...row, id: "p2", userId: "u3", user: BOB }, { ...row, id: "p3", userId: null, hardwareUserId: "117", user: null }]
        }
        const { AttendancePunchService } = await import("@/lib/services/attendance-punch.service")
        const punches = await AttendancePunchService.list("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "COMPANY" })
        expect(punches.map(x => [x.name, x.nameAr])).toEqual([["Sami Nabil", "سامي نبيل"], ["Bob Brown", null], [null, null]])
        expect(asked.query.select.user.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("say whose each is in the page's language, on computers and on phones", async () => {
        ui.punches = [punch({}), punch({ id: "p2", userId: "u3", name: "Bob Brown", nameAr: null }), punch({ id: "p3", userId: null, name: null, nameAr: null, hardwareUserId: "117", source: "IMPORT" })]
        const html = await page("punches", "ar")
        expect(table(html)).toContain('<div class="ui-item-detail">سامي نبيل</div>')
        expect(cards(html)).toContain("سامي نبيل")
        expect(html).not.toContain("Sami Nabil")
        expect(table(html)).toContain('<div class="ui-item-detail">Bob Brown</div>')
        // A number nobody has yet still says so.
        expect(table(html)).toContain(`<div class="ui-item-detail">${ar.punch_number.replace("{code}", "117")}</div>`)
        const english = await page("punches", "en")
        expect(table(english)).toContain('<div class="ui-item-detail">Sami Nabil</div>')
        expect(cards(english)).toContain("Sami Nabil")
        expect(english).not.toContain("سامي نبيل")
    })
})
