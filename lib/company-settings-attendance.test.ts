import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, readdirSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Company settings on the building blocks, part 3a (UI_PLAN.md §5 step 5):
 * the Attendance tab's calendar, that is its schedules, who works which, its
 * holidays, and the dialogs that change them. The panels above it (the policy,
 * pay, terminals, places and face checks) are parts 3b and 3c.
 */

type Loaded = { data?: unknown; error?: unknown; isLoading?: boolean; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    role: "ADMIN",
    swr: {} as Record<string, Loaded>,
}
vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/settings",
    useSearchParams: () => new URLSearchParams("tab=attendance"),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: state.role } } }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
// The panels above the calendar are parts 3b and 3c, each tested on its own.
for (const panel of ["AttendancePayrollPanel", "AttendanceTerminalsPanel", "AttendanceLocationsPanel", "AttendancePolicyPanel", "FaceLegalPanel"]) {
    vi.doMock(`@/components/${panel}`, () => ({ default: () => null }))
}
vi.mock("swr", () => {
    const useSWR = (key: string | null) => {
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    }
    return { default: useSWR, useSWRConfig: () => ({ mutate: async () => {} }) }
})

const KEY = "/api/attendance/calendar?companyId=c1"
const CALENDAR = {
    today: "2026-11-02",
    companyWorkWeek: [0, 1, 2, 3, 4],
    companyWorkWeeks: [{ effectiveFrom: "2020-01-01", workWeek: [0, 1, 2, 3, 4] }],
    schedules: [
        {
            id: "s1", name: "Office", archivedAt: null,
            versions: [
                { id: "v1", effectiveFrom: "2026-01-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60, workWeek: [], days: [{ weekday: 4, startMinutes: 540, endMinutes: 840 }] },
                { id: "v2", effectiveFrom: "2026-12-01", startMinutes: 480, endMinutes: 960, breakMinutes: 60, workWeek: [], days: [] },
            ],
            overrides: [{ id: "o1", name: "Ramadan 2027", startDate: "2027-02-18", endDate: "2027-03-19", startMinutes: 600, endMinutes: 900, breakMinutes: 0, days: [] }],
        },
        {
            id: "s2", name: "Night shift", archivedAt: null,
            versions: [{ id: "v3", effectiveFrom: "2026-01-01", startMinutes: 1320, endMinutes: 1800, breakMinutes: 30, workWeek: [0, 1, 2], days: [] }],
            overrides: [],
        },
        { id: "s3", name: "Old", archivedAt: "2026-05-01T00:00:00.000Z", versions: [], overrides: [] },
    ],
    defaults: [{ id: "d1", scheduleId: "s1", effectiveFrom: "2026-01-01" }, { id: "d2", scheduleId: "s2", effectiveFrom: "2027-01-01" }],
    assignments: [
        { id: "a1", userId: "u2", scheduleId: "s2", effectiveFrom: "2026-03-01" },
        { id: "a2", userId: "u1", scheduleId: "s2", effectiveFrom: "2026-12-01" },
    ],
    people: [{ id: "u1", name: "Hana Saad", role: "ADMIN" }, { id: "u2", name: "Youssef Ali", role: "EMPLOYEE" }],
    holidays: {
        year: 2026,
        public: [
            { id: "p1", date: "2026-10-06", name: "Armed Forces Day", nameAr: "عيد القوات المسلحة", observed: true },
            { id: "p2", date: "2026-07-23", name: "Revolution Day", nameAr: null, observed: false },
        ],
        own: [{ id: "h1", date: "2026-12-31", name: "Year end", isPaid: false }],
    },
    canEdit: true,
}
const loaded = (calendar: unknown = CALENDAR) => ({ [KEY]: { data: { data: calendar } } })
const esc = (s: string) => s.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")

async function tab({ swr = loaded() as Record<string, Loaded>, role = "ADMIN", locale = "en" as "en" | "ar", readOnly = false } = {}) {
    Object.assign(state, { swr, role, locale })
    const { default: Card } = await import("@/components/CompanyAttendanceCard")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(Card, { companyId: "c1", readOnly }))
    } finally {
        vi.unstubAllGlobals()
    }
}

describe("the Attendance tab's calendar", () => {
    it("says it's loading, and that it didn't load, with the server's reason and Try again", async () => {
        expect(await tab({ swr: {} })).toContain('<div class="ui-panel" role="status">')
        const failed = await tab({ swr: { [KEY]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) } } })
        expect(failed).toContain(esc(en.attendance_calendar_load_failed))
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })

    it("gives the Super Admin a link to the company's punches, with no arrow drawn after its name", async () => {
        const html = await tab({ role: "SUPER_ADMIN" })
        expect(html).toMatch(new RegExp(`<a class="ui-btn ui-btn-secondary[^"]*" href="/dashboard/attendance\\?companyId=c1">${en.punch_open}</a>`))
        expect(await tab()).not.toContain('href="/dashboard/attendance?companyId=c1"')
    })
})

describe("the schedules", () => {
    it("are a card saying what they're for, with New schedule for whoever may change them", async () => {
        const html = await tab()
        expect(html).toContain(`<h2 class="ui-card-title">${en.attendance_schedules}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${en.attendance_schedules_hint}</p>`)
        expect(html).toMatch(new RegExp(`ui-btn-primary[^>]*>(<svg[\\s\\S]*?</svg>)?${en.attendance_new_schedule}</button>`))
        expect(await tab({ readOnly: true })).not.toContain(`${en.attendance_new_schedule}</button>`)
    })

    it("list the default changes to come, each with Withdraw named for it", async () => {
        const html = await tab()
        const line = en.attendance_default_from.replace("{name}", "Night shift").replace("{date}", "1 Jan 2027")
        expect(html).toContain(en.attendance_default_from.replace("{name}", "<bdi>Night shift</bdi>").replace("{date}", "1 Jan 2027"))
        expect(html).toMatch(new RegExp(`aria-label="${en.attendance_withdraw_named.replace("{name}", line)}"`))
    })

    it("say there are none yet when there are none", async () => {
        const html = await tab({ swr: loaded({ ...CALENDAR, schedules: [], defaults: [], assignments: [] }) })
        expect(html).toContain(en.attendance_no_schedules.replace(/'/g, "&#x27;"))
    })

    it("each have a card of their own: the name, Default, the hours, the days and how many work them", async () => {
        const html = await tab()
        expect(html).toMatch(/<h2 class="ui-card-title"><bdi>Office<\/bdi> ?<span class="ui-badge ui-badge-progress">Default<\/span><\/h2>/)
        expect(html).toContain('<h2 class="ui-card-title"><bdi>Night shift</bdi></h2>')
        // Archived schedules aren't shown.
        expect(html).not.toContain("<bdi>Old</bdi>")
        expect(html).toContain('<dl class="ui-details">')
        expect(html).toContain(en.attendance_time_range.replace("{start}", "09:00").replace("{end}", "17:00"))
        // A night shift's end is the next day.
        expect(html).toContain(en.attendance_time_range.replace("{start}", "22:00").replace("{end}", "06:00 (+1)"))
        expect(html).toContain(en.attendance_break_n.replace("{n}", "60"))
        // The company's week, said to be the company's; a schedule's own week as it is.
        expect(html).toContain(`Sun Mon Tue Wed Thu (${en.attendance_company_week})`)
        expect(html).toContain("Sun Mon Tue<")
        // Thursday's own hours.
        expect(html).toContain(`Thu ${en.attendance_time_range.replace("{start}", "09:00").replace("{end}", "14:00")}`)
        // Counted in the page's language: "1 employee", never "1 people".
        expect(html).toContain(en.attendance_people_default.replace("{count}", en.count_employees_one))
        expect(html).toContain(`<dd>${en.count_employees_one}</dd>`)
    })

    it("offer their changes in a menu named for the schedule, and none to whoever can only look", async () => {
        const html = await tab()
        expect(html).toContain(`aria-label="${en.ui_more_actions_for.replace("{name}", "Office")}"`)
        expect(await tab({ readOnly: true })).not.toContain(`aria-label="${en.ui_more_actions_for.replace("{name}", "Office")}"`)
    })

    it("list a schedule's changes to come and its seasonal hours under their own headings", async () => {
        const html = await tab()
        expect(html).toContain(`<h3 class="ui-subsection-title">${en.attendance_changes_to_come}</h3>`)
        expect(html).toContain(en.attendance_from_date.replace("{date}", "1 Dec 2026"))
        expect(html).toMatch(new RegExp(`aria-label="${en.attendance_withdraw_named.replace("{name}", en.attendance_from_date.replace("{date}", "1 Dec 2026"))}"`))
        expect(html).toContain(`<h3 class="ui-subsection-title">${en.attendance_overrides}</h3>`)
        expect(html).toContain("<bdi>Ramadan 2027</bdi>")
        expect(html).toContain(en.attendance_date_range.replace("{start}", "18 Feb 2027").replace("{end}", "19 Mar 2027"))
        expect(html).toContain(`aria-label="${en.ui_more_actions_for.replace("{name}", "Ramadan 2027")}"`)
    })

    it("say a time range the way Arabic reads it", async () => {
        const html = await tab({ locale: "ar" })
        expect(ar.attendance_time_range).toContain("{start}")
        expect(html).toContain(ar.attendance_time_range.replace("{start}", "٠٩:٠٠").replace("{end}", "١٧:٠٠"))
        expect(html).toContain(ar.attendance_schedules)
    })
})

describe("who works which schedule", () => {
    it("lists each person with the schedule they're on and the move to come, with Move people", async () => {
        const html = await tab()
        expect(html).toContain(`<h2 class="ui-card-title">${en.attendance_who_works_which}</h2>`)
        expect(html).toContain("<bdi>Hana Saad</bdi>")
        expect(html).toContain(en.attendance_on_default.replace("{name}", "<bdi>Office</bdi>"))
        expect(html).toContain(en.attendance_next_move.replace("{name}", "<bdi>Night shift</bdi>").replace("{date}", "1 Dec 2026"))
        expect(html).toContain("<bdi>Youssef Ali</bdi>")
        expect(html).toMatch(new RegExp(`aria-label="${en.attendance_withdraw_named.replace("{name}", en.attendance_next_move.replace("{name}", "Night shift").replace("{date}", "1 Dec 2026"))}"`))
        expect(html).toMatch(new RegExp(`>${en.attendance_move_people}</button>`))
        expect(await tab({ readOnly: true })).not.toContain(`>${en.attendance_move_people}</button>`)
    })
})

describe("the holidays", () => {
    it("pick their year with a labelled select, and list the public ones as boxes to tick", async () => {
        const html = await tab()
        expect(html).toContain(`<h2 class="ui-card-title">${en.attendance_holidays}</h2>`)
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.year}</label>`))
        expect(html).toContain('<option value="2026" selected="">2026</option>')
        expect(html).toContain(`<h3 class="ui-subsection-title">${en.attendance_public_holidays}</h3>`)
        expect(html).toMatch(/<input type="checkbox" class="ui-check"[^>]*checked=""[^>]*\/><bdi>Armed Forces Day<\/bdi>/)
        expect(html).toContain(en.attendance_worked_through)
    })

    it("list the company's own, each removable, with Add holiday", async () => {
        const html = await tab()
        expect(html).toContain(`<h3 class="ui-subsection-title">${en.attendance_own_holidays}</h3>`)
        expect(html).toContain("<bdi>Year end</bdi>")
        expect(html).toContain(`aria-label="${en.attendance_remove_named.replace("{name}", "Year end")}"`)
        expect(html).toMatch(new RegExp(`>${en.attendance_add_holiday}</button>`))
        const readOnly = await tab({ readOnly: true })
        expect(readOnly).not.toContain(`>${en.attendance_add_holiday}</button>`)
        expect(readOnly).toMatch(/<input type="checkbox" class="ui-check"[^>]*disabled=""/)
    })
})

describe("the dialogs", () => {
    async function hours(editing: unknown, locale: "en" | "ar" = "en") {
        state.locale = locale
        const { default: HoursDialog } = await import("@/components/attendance-calendar/HoursDialog")
        vi.stubGlobal("document", { body: {} })
        try {
            return renderToStaticMarkup(h(HoursDialog, {
                editing, today: "2026-11-02", companyWorkWeeks: CALENDAR.companyWorkWeeks,
                weekdayName: (d: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d], busy: false, onClose: () => {}, onSubmit: async () => {},
            } as never))
        } finally {
            vi.unstubAllGlobals()
        }
    }

    it("ask for a new schedule's name, from when, its hours and its days, each field labelled", async () => {
        const html = await hours({ kind: "schedule" })
        expect(html).toContain('role="dialog"')
        for (const label of [en.attendance_schedule_name, en.attendance_starts, en.attendance_ends, en.attendance_break_minutes]) {
            expect(html, label).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${label.replace(/[()?]/g, "\\$&")}</label>`))
        }
        expect(html).toContain(en.attendance_from_when)
        expect(html).toContain(`<legend class="ui-label">${en.attendance_work_week}</legend>`)
        expect(html).toContain(`<legend class="ui-label">${en.attendance_day_exceptions}</legend>`)
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary[^"]*">${en.save}</button>`))
    })

    it("ask for seasonal hours' first and last day, not from when", async () => {
        const schedule = CALENDAR.schedules[0]
        const html = await hours({ kind: "override", schedule, override: null })
        expect(html).toContain(en.attendance_first_day)
        expect(html).toContain(en.attendance_last_day)
        expect(html).not.toContain(en.attendance_from_when)
        expect(html).not.toContain(`<legend class="ui-label">${en.attendance_work_week}</legend>`)
    })

    it("tell what's wrong with the hours before sending them", async () => {
        const { hoursFromForm } = await import("@/components/attendance-calendar/hours-form")
        const form = { start: "09:00", end: "17:00", breakMinutes: "60", workWeek: [], customWeek: false, days: [] }
        expect(hoursFromForm(form)).toMatchObject({ ok: true, startMinutes: 540, endMinutes: 1020, breakMinutes: 60 })
        expect(hoursFromForm({ ...form, start: "" })).toEqual({ ok: false, error: "attendance_time_invalid", field: "start" })
        expect(hoursFromForm({ ...form, customWeek: true })).toEqual({ ok: false, error: "attendance_work_week_empty", field: "workWeek" })
        expect(hoursFromForm({ ...form, breakMinutes: "-5" })).toEqual({ ok: false, error: "attendance_break_invalid", field: "breakMinutes" })
        expect(hoursFromForm({ ...form, breakMinutes: "" })).toMatchObject({ ok: true, breakMinutes: 0 })
        expect(en.attendance_break_invalid).toBeTruthy()
        expect(ar.attendance_break_invalid).toBeTruthy()
    })
})

describe("nothing of the old card is left", () => {
    it("has no hand-set styles, glass panels, old windows or drawn separators", () => {
        const files = ["components/CompanyAttendanceCard.tsx", ...readdirSync("components/attendance-calendar").map(f => `components/attendance-calendar/${f}`)]
        for (const file of files) {
            const src = readFileSync(file, "utf8")
            for (const old of ["style={", "className=\"glass", "ConfirmModal", "@/components/Modal", "className=\"btn", "className=\"input\"", "isRtl ? 'right'", "' · '", "→"]) {
                expect(src, `${file}: ${old}`).not.toContain(old)
            }
        }
    })
})

describe("found in the browser and the audit (company settings part 3a)", () => {
    it("writes times and minutes in Arabic-Indic digits in Arabic, as the dates beside them are (DESIGN.md §3.3)", async () => {
        const html = await tab({ locale: "ar" })
        expect(html).toContain(ar.attendance_time_range.replace("{start}", "٠٩:٠٠").replace("{end}", "١٧:٠٠"))
        expect(html).toContain(ar.attendance_time_range.replace("{start}", "٢٢:٠٠").replace("{end}", "٠٦:٠٠ (+١)"))
        expect(html).toContain(ar.attendance_break_n.replace("{n}", "٦٠"))
        expect(html).not.toContain("09:00")
        // English keeps its own.
        expect(await tab()).toContain(en.attendance_time_range.replace("{start}", "09:00").replace("{end}", "17:00"))
    })

    it("keeps a schedule's name apart from the sentence around it, so its direction can't reorder the words", async () => {
        const html = await tab()
        expect(html).toContain(en.attendance_on_default.replace("{name}", "<bdi>Office</bdi>"))
        expect(html).toContain(en.attendance_next_move.replace("{name}", "<bdi>Night shift</bdi>").replace("{date}", "1 Dec 2026"))
        expect(html).toContain(en.attendance_default_from.replace("{name}", "<bdi>Night shift</bdi>").replace("{date}", "1 Jan 2027"))
    })

    it("names the year's select", async () => {
        expect(await tab()).toMatch(/<select id="[^"]+" class="ui-select"[^>]*name="year"/)
    })
})
