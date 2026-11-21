import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Public holidays apply, on the Attendance tab's Holidays card
 * (FIRST_CHANGES_PLAN.md §6, DESIGN.md §5.5, PR 362), as the owner approved
 * in the Public holidays off for a company canvas: the switch, a change to
 * come with Withdraw, the public holidays worked through while they're off,
 * and the question asked before each change. All names are made up.
 */

const state = { locale: "en" as "en" | "ar", swr: {} as Record<string, { data?: unknown }> }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/settings",
    useSearchParams: () => new URLSearchParams("tab=attendance"),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: "ADMIN" } } }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
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

type Change = { id: string; effectiveFrom: string; apply: boolean }
const esc = (text: string) => text.replace(/'/g, "&#x27;")
const re = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const KEY = "/api/attendance/calendar?companyId=c1"
const calendar = (changes: Change[], applies: [boolean, boolean] = [true, true], canEdit = true) => ({
    today: "2026-11-02", companyWorkWeek: [0, 1, 2, 3, 4], companyWorkWeeks: [], schedules: [], defaults: [], assignments: [], people: [],
    holidays: {
        year: 2026,
        public: [
            { id: "p1", date: "2026-07-23", name: "Revolution Day", nameAr: "عيد ثورة ٢٣ يوليو", observed: true, applies: applies[0] },
            { id: "p2", date: "2026-10-06", name: "Armed Forces Day", nameAr: "عيد القوات المسلحة", observed: false, applies: applies[1] },
        ],
        own: [{ id: "h1", date: "2026-12-31", name: "Year end", isPaid: true }],
    },
    canEdit, sections: { terminals: false, mobileApp: false },
    publicHolidays: { changes, earliest: changes.length ? null : "2026-10-01" },
})
const OFF_OCT = [{ id: "ch1", effectiveFrom: "2026-10-01", apply: false }]
const COMING = [{ id: "ch2", effectiveFrom: "2026-12-01", apply: false }]

async function tab(body: unknown, { locale = "en" as "en" | "ar", readOnly = false } = {}) {
    Object.assign(state, { locale, swr: { [KEY]: { data: { data: body } } } })
    const { default: Card } = await import("@/components/CompanyAttendanceCard")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(Card, { companyId: "c1", readOnly }))
    } finally {
        vi.unstubAllGlobals()
    }
}
/** The Holidays card's public holidays, from its heading to the company's own. */
const publicPart = (html: string, words = en) => html.slice(html.indexOf(`>${words.attendance_public_holidays}</h3>`), html.indexOf(`>${words.attendance_own_holidays}</h3>`))
/** The switch's list. */
const switchOf = (html: string) => {
    const at = html.indexOf('class="ui-rows ui-rows-flush ui-public-switch"')
    expect(at).toBeGreaterThan(-1)
    return html.slice(at, html.indexOf("</ul>", at))
}

describe("the switch", () => {
    it("sits at the top of the public holidays, on, with Turn off, for whoever may change the tab", async () => {
        const part = publicPart(await tab(calendar([])))
        const row = switchOf(part)
        expect(part.indexOf("ui-public-switch")).toBeLessThan(part.indexOf("Revolution Day"))
        expect(row).toContain(`aria-label="${en.attendance_public_apply}"`)
        expect(row).toContain(`<span class="ui-item-title">${en.attendance_public_apply}</span>`)
        expect(row).toContain(esc(en.attendance_public_on_hint))
        expect(row).toMatch(new RegExp(`ui-badge-good[^>]*>${en.attendance_public_on_badge}<`))
        expect(row).toMatch(new RegExp(`>${en.settings_turn_off}</button>`))
        expect(row).not.toContain(`>${en.settings_turn_on}</button>`)
        // The holidays keep their boxes.
        expect(part).toMatch(/<input type="checkbox" class="ui-check"[^>]*\/><bdi>Revolution Day<\/bdi>/)
    })

    it("shows its state and no button to whoever may only look", async () => {
        for (const html of [await tab(calendar([]), { readOnly: true }), await tab(calendar(OFF_OCT, [true, false], false))]) {
            const row = switchOf(publicPart(html))
            expect(row).toContain("ui-badge")
            expect(row).not.toContain("</button>")
        }
    })

    it("off: says from when, with Turn on, and lists each holiday from then worked through, without its box", async () => {
        const part = publicPart(await tab(calendar(OFF_OCT, [true, false])))
        const row = switchOf(part)
        expect(row).toContain(esc(en.attendance_public_off_hint.replace("{date}", "1 Oct 2026")))
        expect(row).toMatch(new RegExp(`ui-badge-neutral[^>]*>${en.attendance_public_off_badge}<`))
        expect(row).toMatch(new RegExp(`ui-btn-primary[^"]*"[^>]*>${en.settings_turn_on}</button>`))
        expect(part).toContain(`<p class="ui-card-note">${en.attendance_public_off_note.replace("{date}", "1 Oct 2026")}</p>`)
        // Before the date, its box; from it, the badge alone.
        expect(part).toMatch(/<input type="checkbox" class="ui-check"[^>]*\/><bdi>Revolution Day<\/bdi>/)
        expect(part).toMatch(new RegExp(`<div class="ui-choice ui-public-off"><bdi>Armed Forces Day</bdi><span class="ui-hint">6 Oct 2026</span><span class="ui-badge ui-badge-neutral">${en.attendance_worked_through}</span></div>`))
        expect(part).not.toMatch(/<input[^>]*\/><bdi>Armed Forces Day/)
    })

    it("lists a change from a later date, with Withdraw named for it, and has no button until it's withdrawn", async () => {
        const part = publicPart(await tab(calendar(COMING)))
        const row = switchOf(part)
        const line = en.attendance_public_coming_off.replace("{date}", "1 Dec 2026")
        expect(row).toContain(`<span class="ui-item-title">${line}</span>`)
        expect(row).toContain(`aria-label="${en.attendance_withdraw_named.replace("{name}", line)}"`)
        expect(row).toMatch(new RegExp(`>${en.attendance_withdraw}</button>`))
        expect(row).not.toContain(`>${en.settings_turn_off}</button>`)
        // Still on today, and the year's holidays before it keep their boxes, with no line about them.
        expect(row).toMatch(new RegExp(`ui-badge-good[^>]*>${en.attendance_public_on_badge}<`))
        expect(part).not.toContain(en.attendance_public_off_note.slice(0, 20))
        const backOn = switchOf(publicPart(await tab(calendar([...OFF_OCT, { id: "ch3", effectiveFrom: "2026-12-01", apply: true }], [true, false]))))
        expect(backOn).toContain(en.attendance_public_coming_on.replace("{date}", "1 Dec 2026"))
    })

    it("in Arabic, with Arabic digits", async () => {
        const part = publicPart(await tab(calendar(OFF_OCT, [true, false]), { locale: "ar" }), ar)
        const row = switchOf(part)
        expect(row).toContain(`aria-label="${ar.attendance_public_apply}"`)
        expect(row).toContain(ar.attendance_public_off_hint.replace("{date}", "١ أكتوبر ٢٠٢٦"))
        expect(row).toContain(`>${ar.attendance_public_off_badge}<`)
        expect(row).toContain(`>${ar.settings_turn_on}</button>`)
        expect(part).toContain("<bdi>عيد القوات المسلحة</bdi><span class=\"ui-hint\">٦ أكتوبر ٢٠٢٦</span>")
        expect(part).toContain(ar.attendance_public_off_note.replace("{date}", "١ أكتوبر ٢٠٢٦"))
    })
})

async function dialog(props: Record<string, unknown>, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { PublicHolidaysDialog } = await import("@/components/attendance-calendar/Dialogs")
    const intl = locale === "ar" ? "ar-EG" : "en-GB"
    const dateText = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(PublicHolidaysDialog, {
            apply: false, today: "2026-11-02", earliest: "2026-10-01", lastChange: null, dateText, busy: false, onClose: () => {}, onSubmit: async () => {}, ...props,
        } as never))
    } finally {
        vi.unstubAllGlobals()
    }
}

describe("the question before each change", () => {
    it("turning them off: what changes, From when? from today, and the earliest it may be, by payroll", async () => {
        const html = await dialog({})
        expect(html).toContain(en.attendance_public_off_title)
        expect(html).toContain(`<p>${esc(en.attendance_public_off_body)}</p>`)
        expect(html).toMatch(new RegExp(`class="ui-label">${re(en.attendance_from_when)}</label>`))
        expect(html).toContain(">2 Nov 2026</button>")
        expect(html).toContain(`${en.attendance_public_from_hint} ${esc(en.attendance_public_earliest_payroll.replace("{date}", "1 Oct 2026"))}`)
        expect(html).toMatch(new RegExp(`>${en.cancel}</button>`))
        expect(html).toMatch(new RegExp(`>${en.attendance_public_turn_off}</button>`))
    })

    it("turning them back on, after a change today: from the day after, which it says", async () => {
        const html = await dialog({ apply: true, earliest: "2026-11-03", lastChange: "2026-11-02" })
        expect(html).toContain(en.attendance_public_on_title)
        expect(html).toContain(">3 Nov 2026</button>")
        expect(html).toContain(en.attendance_public_earliest_change.replace("{last}", "2 Nov 2026").replace("{date}", "3 Nov 2026"))
        expect(html).toMatch(new RegExp(`>${en.attendance_public_turn_on}</button>`))
    })

    it("says only that attendance is worked out again when anything goes", async () => {
        const html = await dialog({ earliest: null })
        expect(html).toContain(`<span id="`)
        expect(html).toContain(`class="ui-hint">${en.attendance_public_from_hint}</span>`)
    })

    it("in Arabic", async () => {
        const html = await dialog({}, "ar")
        expect(html).toContain(ar.attendance_public_off_title)
        expect(html).toContain(ar.attendance_public_earliest_payroll.replace("{date}", "١ أكتوبر ٢٠٢٦"))
        expect(html).toContain(`>${ar.attendance_public_turn_off}</button>`)
    })
})

describe("its words and look", () => {
    it("has every word in both languages, and the badge agrees with the holidays in Arabic", () => {
        const keys = Object.keys(en).filter(k => k.startsWith("attendance_public_") && k !== "attendance_public_holidays")
        expect(keys.length).toBe(21)
        for (const key of keys) expect(ar[key as keyof typeof ar], key).toBeTruthy()
        expect(ar.attendance_public_on_badge).toBe("مطبَّقة")
        expect(ar.attendance_public_off_badge).toBe("متوقفة")
    })

    it("draws the switch on the page's colour, with tokens, and puts its badge and button under the line on phones", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        const block = css.slice(css.indexOf(".ui-public-switch {"), css.indexOf("/* A company's client messages, on the Client portal tab"))
        expect(block).toContain("background: var(--page);")
        expect(block).toContain("border-radius: var(--radius-panel);")
        expect(block).not.toMatch(/#[0-9a-f]{3,6}\b/i)
        expect(block).toMatch(/@media \(max-width: 767px\) \{\s*\.ui-public-switch \.ui-row \{\s*flex-direction: column;/)
        // A holiday worked through wraps on a narrow phone, its date whole (found at 320px).
        expect(block).toMatch(/\.ui-public-off \{\s*flex-wrap: wrap;/)
        expect(block).toMatch(/\.ui-public-off > \.ui-hint \{\s*white-space: nowrap;/)
    })

    it("is in DESIGN.md as the owner approved it", () => {
        const design = readFileSync("DESIGN.md", "utf8")
        const block = design.slice(design.indexOf("- **Public holidays apply:**"), design.indexOf("- **Check-in:**"))
        expect(block).toContain("Public holidays off for a company canvas")
        expect(block).toContain("Worked through")
        expect(block).toContain("From when?")
        expect(block).toContain("Withdraw")
    })
})
