import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { dayText } from "./calendar-text"
import { stripComments } from "./strip-comments"

/**
 * From when, for the policy and the schedules (LATER_CHANGES_PLAN.md §7.19;
 * DESIGN.md §5.5): a company's first policy and its first schedule start,
 * unless changed, on the first day of the payroll month today is in, so a
 * company setting up in the middle of a month has the whole month measured.
 * Later changes keep their dates: the first of next month, and another new
 * schedule today.
 */

vi.setConfig({ testTimeout: 60_000 })

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))

const TODAY = "2026-11-20"
const MONTH_START = "2026-11-01"
const SCHEDULE = {
    id: "s1", name: "Office", archivedAt: null,
    versions: [{ id: "v1", effectiveFrom: "2026-11-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60, workWeek: [], days: [] }],
    overrides: [],
}

async function hours(editing: unknown, firstFrom?: string) {
    state.locale = "en"
    const { default: HoursDialog } = await import("@/components/attendance-calendar/HoursDialog")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(HoursDialog, {
            editing, today: TODAY, firstFrom, companyWorkWeeks: [],
            weekdayName: (d: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d], busy: false, onClose: () => {}, onSubmit: async () => {},
        } as never))
    } finally {
        vi.unstubAllGlobals()
    }
}
/** The day From when? holds, as its button says it. */
const fromWhen = (html: string) => html.match(/class="ui-input ui-date-trigger"[^>]*>([^<]*)<\/button>/)?.[1]

describe("a company's first schedule", () => {
    it("starts on the payroll month's first day unless changed", async () => {
        expect(fromWhen(await hours({ kind: "schedule" }, MONTH_START))).toBe(dayText(MONTH_START, "en"))
    })

    it("is the only new schedule that does: another starts today, as before", async () => {
        expect(fromWhen(await hours({ kind: "schedule" }))).toBe(dayText(TODAY, "en"))
    })

    it("and a change to a schedule's hours still starts on the first of next month", async () => {
        expect(fromWhen(await hours({ kind: "version", schedule: SCHEDULE }, MONTH_START))).toBe(dayText("2026-12-01", "en"))
    })

    it("is the first while the company has no default schedule, as the first one becomes it", () => {
        const card = stripComments(readFileSync("components/CompanyAttendanceCard.tsx", "utf8"))
        expect(card).toContain("firstFrom={data.defaults.length === 0 ? data.monthStart : undefined}")
        const types = stripComments(readFileSync("components/attendance-calendar/types.ts", "utf8"))
        expect(types).toMatch(/monthStart: string/)
    })
})

describe("a company's first policy", () => {
    it("starts on the payroll month's first day unless changed; a later change on the first of next month", () => {
        const panel = stripComments(readFileSync("components/AttendancePolicyPanel.tsx", "utf8"))
        expect(panel).toContain("defaultFrom={shown ? firstOfNextMonth(data.today) : data.monthStart}")
    })

    it("has the day sent with the policy", () => {
        const route = stripComments(readFileSync("app/api/attendance/policy/route.ts", "utf8"))
        expect(route).toMatch(/monthStart/)
        expect(route).toContain("AttendanceCalendarService.monthStart(")
    })
})
