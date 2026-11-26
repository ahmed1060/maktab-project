import { describe, it, expect, vi, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { prismaMock } from "./permissions/employee-access.harness"

/**
 * The work calendar and the policy preview with each person's name in the
 * page's language (LATER_CHANGES_PLAN.md §3.1, step 8k; PR 422): who works
 * which schedule, in the page's order; the people Move people offers, in
 * the page's order; withdrawing someone's move; and the people a policy
 * change would move. Each name is in the page's language, or in the one it
 * has while it has only one. On an Arabic page, those with an Arabic name
 * come first, in Arabic order, then the rest as they came.
 */

// The first import of the panels and the services takes a while.
vi.setConfig({ testTimeout: 60_000 })

const ui = { locale: "en" as "en" | "ar" }
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-dom")>(), createPortal: (node: unknown) => node }))

const t = (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key
// The people as the server sends them, by their English: Bob, Hana, Sami.
const PEOPLE = [
    { id: "u3", name: "Bob Brown", nameAr: null, role: "EMPLOYEE" },
    { id: "u1", name: "Hana Saad", nameAr: "هناء سعد", role: "EMPLOYEE" },
    { id: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", role: "EMPLOYEE" },
]
const IN_ARABIC = ["سامي نبيل", "هناء سعد", "Bob Brown"]
const IN_ENGLISH = ["Bob Brown", "Hana Saad", "Sami Nabil"]
const OFFICE = { id: "s1", name: "Office", archivedAt: null, versions: [{ id: "v1", effectiveFrom: "2026-01-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60, workWeek: [0, 1, 2, 3, 4] }], overrides: [] }
const CALENDAR = {
    today: "2026-10-31", companyWorkWeek: [0, 1, 2, 3, 4], companyWorkWeeks: [],
    schedules: [OFFICE], defaults: [{ id: "d1", scheduleId: "s1", effectiveFrom: "2026-01-01" }],
    // Sami moves to the same schedule from December, so a move can be withdrawn.
    assignments: [{ id: "a1", userId: "u2", scheduleId: "s1", effectiveFrom: "2026-12-01" }],
    people: PEOPLE,
    holidays: { year: 2026, public: [], own: [] }, canEdit: true,
    sections: { terminals: false, mobileApp: false }, publicHolidays: { changes: [], earliest: null },
}
const SAMI = { firstName: "Sami", lastName: "Nabil", firstNameAr: "سامي", lastNameAr: "نبيل" }
const BOB = { firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null }

afterEach(() => { vi.unstubAllGlobals() })

describe("who works which schedule", () => {
    it("is given each person's name in both languages", async () => {
        const asked: { query?: any } = {}
        prismaMock.user.findMany = async (query: any) => {
            if (query.select?.role) asked.query = query
            return [{ id: "u2", ...SAMI, role: "EMPLOYEE" }, { id: "u3", ...BOB, role: "EMPLOYEE" }]
        }
        prismaMock.company.findUnique = async () => ({ timezone: "Africa/Cairo" })
        const { AttendanceCalendarService } = await import("@/lib/services/attendance-calendar.service")
        const calendar = await AttendanceCalendarService.calendar("c1", 2026)
        expect(calendar.people).toEqual([
            { id: "u2", name: "Sami Nabil", nameAr: "سامي نبيل", role: "EMPLOYEE" },
            { id: "u3", name: "Bob Brown", nameAr: null, role: "EMPLOYEE" },
        ])
        expect(asked.query.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    const card = async (locale: "en" | "ar", asked: { body?: string } = {}) => {
        ui.locale = locale
        const { PeopleCard } = await import("@/components/attendance-calendar/People")
        const ctx = {
            companyId: "c1", data: CALENDAR, active: [OFFICE], editable: true, busy: false, locale, t,
            send: async () => true, setMoving: () => {}, dateText: (d: string) => d,
            askFirst: (c: { body: string }) => { asked.body = c.body },
        }
        return renderToStaticMarkup(h(PeopleCard, { ctx: ctx as never }))
    }
    const rows = (html: string) => (html.match(/<bdi>(Bob Brown|Hana Saad|Sami Nabil|سامي نبيل|هناء سعد)<\/bdi>/g) ?? []).map(x => x.replace(/<[^>]+>/g, ""))

    it("names each person in the page's language, in the page's order", async () => {
        expect(rows(await card("ar"))).toEqual(IN_ARABIC)
        expect(rows(await card("en"))).toEqual(IN_ENGLISH)
    })

    it("names whose move is withdrawn in the page's language", () => {
        // It asks first, from a click, so its code is read.
        const source = readFileSync("components/attendance-calendar/People.tsx", "utf8")
        expect(source).toContain("body: t('attendance_withdraw_move_body').replace('{name}', named(r)),")
    })
})

describe("Move people", () => {
    it("offers the people in the page's language and order", async () => {
        const { MoveDialog } = await import("@/components/attendance-calendar/Dialogs")
        const dialog = (locale: "en" | "ar") => {
            ui.locale = locale
            vi.stubGlobal("document", { body: {} })
            const html = renderToStaticMarkup(h(MoveDialog, { data: CALENDAR as never, active: [OFFICE] as never, busy: false, onClose: () => {}, onSubmit: async () => {} }))
            return (html.match(/<label class="ui-choice"><input type="checkbox"[^>]*\/><bdi>[^<]*<\/bdi>/g) ?? []).map(x => x.replace(/<[^>]+>/g, ""))
        }
        expect(dialog("ar")).toEqual(IN_ARABIC)
        expect(dialog("en")).toEqual(IN_ENGLISH)
    })
})

describe("the policy preview", () => {
    it("names the people a change would move in the page's language", () => {
        // Its people come back from a button, so its code is read.
        const source = readFileSync("components/attendance-policy/Simulation.tsx", "utf8")
        expect(source).toContain("title={<bdi>{nameIn(locale, { en: x.name, ar: x.nameAr })}</bdi>}")
    })
})
