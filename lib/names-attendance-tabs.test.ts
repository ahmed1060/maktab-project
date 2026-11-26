import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { prismaMock, as, url } from "./permissions/employee-access.harness"
import { state as access } from "./permissions/employee-access.harness"

/**
 * Attendance's Exceptions, Requests and Face tabs with each person's name in
 * the page's language (LATER_CHANGES_PLAN.md §3.1, step 8i; PR 420): whose
 * each exception and decision is, and a day's late arrivals and early
 * leaves in the page's order; the people Approve overtime ahead offers; and
 * the Face tab's photos, people and overdue re-verifications, its people in
 * the page's order. Each name is in the page's language, or in the one it
 * has while it has only one.
 */

// The first import of the page and the services takes a while.
vi.setConfig({ testTimeout: 60_000 })

const ui = {
    locale: "en" as "en" | "ar",
    grants: new Set(["attendance.view_team", "attendance.correct", "attendance.approve_overtime", "attendance.approve_face"]),
    search: "tab=exceptions",
    exceptions: undefined as unknown,
    reviews: [] as unknown[],
    facePeople: undefined as unknown,
}
vi.mock("next-auth", () => ({ getServerSession: async () => access.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: "ADMIN" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => ui.grants.has(p), companyWide: (p: string) => ui.grants.has(p), canFor: (p: string) => ui.grants.has(p) }) }))
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
        if (key?.startsWith("/api/attendance/exceptions")) return { ...idle, data: { data: ui.exceptions } }
        if (key?.startsWith("/api/attendance/face/reviews")) return { ...idle, data: { data: ui.reviews } }
        if (key?.startsWith("/api/attendance/face/people")) return { ...idle, data: { data: ui.facePeople } }
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
const row = (fields: Record<string, unknown> = {}) => ({
    id: "d1", userId: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", teamLeaderId: null, date: "2026-10-15", status: "PRESENT",
    firstIn: "2026-10-15T09:12:00", lastOut: "2026-10-15T17:00:00", lateMinutes: 12, earlyLeaveMinutes: 0, overtimeMinutes: 0,
    deductionMinor: 12500, breakdown: { lateness: { minutes: 12, days: 0.25, occurrence: 3, note: "CHARGED" }, earlyLeave: none, absenceDays: 0 },
    expectedStartMinutes: 540, expectedEndMinutes: 1020,
    ...fields,
})
const bob = (fields: Record<string, unknown> = {}) => row({ userId: "u3", name: "Bob Brown", nameAr: null, ...fields })
const EXCEPTIONS = {
    late: [row(), bob({ id: "d1b" })], early: [],
    absent: [row({ id: "d2", status: "ABSENT", firstIn: null, lastOut: null, lateMinutes: 0 }), bob({ id: "d2b", status: "ABSENT", firstIn: null, lastOut: null, lateMinutes: 0 })],
    incomplete: [row({ id: "d3", status: "INCOMPLETE", lastOut: null, lateMinutes: 0 }), bob({ id: "d3b", status: "INCOMPLETE", lastOut: null, lateMinutes: 0 })],
    departure: [row({ id: "d4", status: "TO_CONFIRM", lateMinutes: 0, earlyLeaveMinutes: 200 }), bob({ id: "d4b", status: "TO_CONFIRM", lateMinutes: 0, earlyLeaveMinutes: 200 })],
    overtime: [row({ id: "d5", lateMinutes: 0, overtimeMinutes: 60 }), bob({ id: "d5b", lateMinutes: 0, overtimeMinutes: 60 })],
    decided: [
        { id: "x1", userId: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", teamLeaderId: null, date: "2026-10-14", subject: "LATENESS", outcome: "EXCUSED", reason: "Bus strike" },
        { id: "x2", userId: "u3", name: "Bob Brown", nameAr: null, teamLeaderId: null, date: "2026-10-14", subject: "LATENESS", outcome: "ACCEPTED", reason: null },
    ],
    counts: { late: 2, early: 0, absent: 2, incomplete: 2, departure: 2, overtime: 2, permissions: null, missing: null, unmatched: null, faceOverdue: null },
    capped: {},
}

async function page(search: string, locale: "en" | "ar") {
    ui.locale = locale
    ui.search = search
    const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
    const html = renderToStaticMarkup(h(AttendancePage))
    return html.slice(html.indexOf('<div role="tabpanel"'))
}
const table = (html: string) => {
    const at = html.indexOf('<table class="ui-table">')
    return at < 0 ? "" : html.slice(at, html.indexOf("</table>", at))
}
const cards = (html: string) => {
    const at = html.indexOf('<ul class="ui-cards"')
    return at < 0 ? "" : html.slice(at, html.indexOf("</ul>", at))
}
const choices = (html: string) => (html.match(/<option value="u\d">[^<]*<\/option>/g) ?? []).map(o => o.replace(/<[^>]+>/g, ""))

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"))
    ui.exceptions = EXCEPTIONS
    ui.reviews = []
    ui.facePeople = { company: { allowed: true, reason: null }, people: [], overdue: [] }
})
afterEach(() => { vi.useRealTimers() })

describe("the exceptions", () => {
    it("are given whose each exception and decision is in both languages", async () => {
        const asked: any[] = []
        const day = { id: "d1", userId: "u2", date: new Date("2026-10-15T00:00:00Z"), firstInAt: null, lastOutAt: null, deductionDays: 0, breakdown: {}, user: { ...SAMI, teamLeaderId: null } }
        prismaMock.attendanceDayDecision.findMany = async (query: unknown) => {
            asked.push(query)
            return [{ id: "x1", userId: "u3", date: new Date("2026-10-14T00:00:00Z"), subject: "ABSENCE", outcome: "EXCUSED", reason: null, user: { ...BOB, teamLeaderId: null } }]
        }
        prismaMock.attendanceDay.findMany = async (query: unknown) => { asked.push(query); return [day] }
        const { AttendanceExceptionService } = await import("@/lib/services/attendance-exception.service")
        const out = await AttendanceExceptionService.list("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "COMPANY" }, { permissions: null, missing: null, unmatched: false })
        expect([out.late[0].name, out.late[0].nameAr]).toEqual(["Sami Nabil", "سامي نبيل"])
        expect([out.decided[0].name, out.decided[0].nameAr]).toEqual(["Bob Brown", null])
        for (const query of asked) expect(query.include.user.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("say whose each is in the page's language, in each kind's table and cards", async () => {
        for (const kind of ["lateEarly", "absent", "incomplete", "departure", "overtime", "decided"]) {
            const html = await page(`tab=exceptions&kind=${kind}`, "ar")
            expect(table(html), kind).toContain('<div class="ui-item-detail">سامي نبيل</div>')
            expect(table(html), kind).toContain('<div class="ui-item-detail">Bob Brown</div>')
            expect(cards(html), kind).toContain("سامي نبيل")
            expect(html, kind).not.toContain("Sami Nabil")
            const english = await page(`tab=exceptions&kind=${kind}`, "en")
            expect(table(english), kind).toContain('<div class="ui-item-detail">Sami Nabil</div>')
            expect(cards(english), kind).toContain("Sami Nabil")
            expect(english, kind).not.toContain("سامي نبيل")
        }
    })

    it("list a day's late arrivals in the page's order", async () => {
        const html = table(await page("tab=exceptions", "ar"))
        expect(html.indexOf("سامي نبيل")).toBeGreaterThan(-1)
        expect(html.indexOf("سامي نبيل")).toBeLessThan(html.indexOf("Bob Brown"))
        const english = table(await page("tab=exceptions", "en"))
        expect(english.indexOf("Bob Brown")).toBeGreaterThan(-1)
        expect(english.indexOf("Bob Brown")).toBeLessThan(english.indexOf("Sami Nabil"))
    })
})

describe("what a dialog opened by a click says", () => {
    // These open from a click, or only in a browser, so the code itself is read.
    const exceptions = readFileSync("app/(dashboard)/dashboard/attendance/ExceptionsTab.tsx", "utf8")
    const face = readFileSync("app/(dashboard)/dashboard/attendance/FaceTab.tsx", "utf8")

    it("names whose day is being excused, or settled, in the page's language", () => {
        expect(exceptions).toContain("<Details items={[{ label: t('punch_person'), value: named(row) },")
    })

    it("names whom a re-verification is asked of, and whose photo is open, in the page's language", () => {
        expect(face).toContain("t('face_reverify_confirm').replace('{name}', askingReverify ? nameOf(askingReverify) : '')")
        expect(face).toContain("t('face_review_title').replace('{name}', shownName(locale, review))")
    })
})

describe("Approve overtime ahead", () => {
    it("offers the people in the page's language and order", async () => {
        const { OvertimeAheadForm } = await import("@/app/(dashboard)/dashboard/attendance/RequestsTab")
        const form = (locale: "en" | "ar") => {
            ui.locale = locale
            return choices(renderToStaticMarkup(h(OvertimeAheadForm, { today: "2026-10-31", companyId: null, people: PEOPLE, onCancel: () => {}, onDone: () => {} })))
        }
        expect(form("ar")).toEqual(["سامي نبيل", "هناء سعد", "Bob Brown"])
        expect(form("en")).toEqual(["Bob Brown", "Hana Saad", "Sami Nabil"])
    })
})

describe("the Face tab", () => {
    const REVIEWS = [
        { id: "r1", userId: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", purpose: "ENROLMENT", createdAt: "2026-10-30T07:05:00.000Z", attested: true, hasReference: false },
        { id: "r2", userId: "u3", name: "Bob Brown", nameAr: null, purpose: "REVERIFY", createdAt: "2026-10-30T08:05:00.000Z", attested: true, hasReference: true },
    ]
    const FACE_PEOPLE = {
        company: { allowed: true, reason: null },
        people: [
            { id: "u3", name: "Bob Brown", nameAr: null, required: false, consentedAt: null },
            { id: "u1", name: "Hana Saad", nameAr: "هناء سعد", required: true, consentedAt: null },
            { id: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", required: false, consentedAt: null },
        ],
        overdue: [{ userId: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", since: "2026-10-20" }],
    }

    it("is given the photos' and people's names in both languages", async () => {
        const asked: any[] = []
        prismaMock.faceReview.findMany = async (query: any) => {
            asked.push(query)
            return query.select.user ? [{ id: "r1", userId: "u2", purpose: "ENROLMENT", createdAt: new Date(), attested: true, modelVersion: "m1", user: SAMI }] : []
        }
        const { FaceReviewService } = await import("@/lib/services/face-review.service")
        const reviews = await FaceReviewService.open("c1", null)
        expect([reviews[0].name, reviews[0].nameAr]).toEqual(["Sami Nabil", "سامي نبيل"])
        expect(asked[0].select.user.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })

        const people: { query?: any } = {}
        prismaMock.user.findMany = async (query: any) => {
            if (query.select.biometricConsents) people.query = query
            return query.select.biometricConsents ? [{ id: "u2", ...SAMI, faceVerificationRequired: true, biometricConsents: [] }, { id: "u3", ...BOB, faceVerificationRequired: false, biometricConsents: [] }] : []
        }
        as("admin")
        const res = await (await import("@/app/api/attendance/face/people/route")).GET(new Request(url("/api/attendance/face/people")))
        const body = (await res.json()).data
        expect(body.people.map((p: any) => [p.name, p.nameAr])).toEqual([["Sami Nabil", "سامي نبيل"], ["Bob Brown", null]])
        expect(people.query.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("names the photos waiting in the page's language, in their table and cards", async () => {
        ui.reviews = REVIEWS
        const html = await page("tab=face", "ar")
        expect(table(html)).toContain("سامي نبيل")
        expect(table(html)).toContain("Bob Brown")
        expect(cards(html)).toContain("سامي نبيل")
        expect(html).not.toContain("Sami Nabil")
        const english = await page("tab=face", "en")
        expect(table(english)).toContain("Sami Nabil")
        expect(english).not.toContain("سامي نبيل")
    })

    it("lists whom it's asked of in the page's language and order, each box named", async () => {
        ui.facePeople = FACE_PEOPLE
        const html = await page("tab=face", "ar")
        const at = (name: string) => html.indexOf(`aria-label="${ar.face_ask_of.replace("{name}", name)}"`)
        expect(at("سامي نبيل")).toBeGreaterThan(-1)
        expect(at("سامي نبيل")).toBeLessThan(at("هناء سعد"))
        expect(at("هناء سعد")).toBeLessThan(at("Bob Brown"))
        // The table and the cards name them too.
        expect(table(html)).toContain("سامي نبيل")
        expect(cards(html)).toContain("سامي نبيل")
        expect(html).not.toContain("Sami Nabil")
        const english = await page("tab=face", "en")
        const atEn = (name: string) => english.indexOf(`aria-label="${en.face_ask_of.replace("{name}", name)}"`)
        expect(atEn("Bob Brown")).toBeGreaterThan(-1)
        expect(atEn("Bob Brown")).toBeLessThan(atEn("Hana Saad"))
        expect(atEn("Hana Saad")).toBeLessThan(atEn("Sami Nabil"))
    })

    it("names whose re-verification is overdue in the page's language", async () => {
        ui.facePeople = { ...FACE_PEOPLE, people: [] }
        expect(await page("tab=face", "ar")).toContain("سامي نبيل")
        expect(await page("tab=face", "en")).toContain("Sami Nabil")
    })
})
