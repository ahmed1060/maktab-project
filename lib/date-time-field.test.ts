import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * A date and a time (DESIGN.md §5.3): a deadline is a field whose button
 * opens the date fields' calendar (components/ui/Calendar.tsx), with the
 * time under its days in the browser's own time field, as the app's other
 * times are. It was a window of its own making: its month names and
 * weekdays typed in, its time in three drop-downs of their own, and its
 * Confirm Selection button in a gradient.
 */

const ui = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
const render = (el: ReturnType<typeof h>, locale: "en" | "ar" = "en") => { ui.locale = locale; return renderToStaticMarkup(el) }
// Rendered as the browser has it, once hydrated; one test renders as the server does.
const hydration = { done: true }
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => hydration.done }))

const PICKER = "components/DateTimePicker.tsx"
const code = (file: string) => stripComments(readFileSync(file, "utf8"))
/** Its spaces as one, whatever this Node's Intl puts before "pm" or after a comma. */
const spaced = (text: string | null | undefined) => text?.replace(/\s+/g, " ")
/** A moment in the browser's own time zone, as a deadline is picked. */
const at = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString()
/** What the field's button says. */
const words = (html: string) => {
    const m = /<button[^>]*class="ui-input ui-date-trigger"[^>]*>([\s\S]*?)<\/button>/.exec(html)
    return m?.[1].replace(/<[^>]+>/g, "")
}
const trigger = (html: string) => /<button[^>]*class="ui-input ui-date-trigger"[^>]*>/.exec(html)?.[0] ?? ""

describe("a date and a time's words (lib/calendar-text.ts)", () => {
    it("are the day, then the time, in the page's language", async () => {
        const { dateTimeText } = await import("./calendar-text")
        const five = spaced(dateTimeText(at(2026, 11, 6, 17), "en"))!
        expect(five.startsWith("6 Nov 2026")).toBe(true)
        expect(five.endsWith("5:00 pm")).toBe(true)
        expect(spaced(dateTimeText(at(2026, 11, 6, 9, 5), "en"))!.endsWith("9:05 am")).toBe(true)
        const arabic = spaced(dateTimeText(at(2026, 11, 6, 17), "ar"))!
        expect(arabic.startsWith("٦ نوفمبر ٢٠٢٦")).toBe(true)
        expect(arabic.endsWith("٥:٠٠ م")).toBe(true)
        expect(arabic).not.toMatch(/[0-9]/)
    })

    it("are nothing for a time that names none, as an upload can hold", async () => {
        const { dateTimeText } = await import("./calendar-text")
        expect(dateTimeText("", "en")).toBeNull()
        expect(dateTimeText("next Friday", "en")).toBeNull()
    })
})

describe("a date and a time's moment (lib/date-time.ts)", () => {
    it("has the day of the browser's own clock, and its time as a time field holds it", async () => {
        const { dayOf, timeOf } = await import("./date-time")
        expect(dayOf(at(2026, 11, 6, 23, 30))).toBe("2026-11-06")
        expect(timeOf(at(2026, 11, 6, 17, 5))).toBe("17:05")
        expect(dayOf("")).toBeNull()
        expect(timeOf("next Friday")).toBe("")
    })

    it("keeps its time when another day is picked, or is at noon when it has none", async () => {
        const { onDay } = await import("./date-time")
        expect(onDay(at(2026, 11, 6, 17, 30), "2026-11-20")).toBe(at(2026, 11, 20, 17, 30))
        expect(onDay("", "2026-11-20")).toBe(at(2026, 11, 20, 12))
        expect(onDay("next Friday", "2026-11-20")).toBe(at(2026, 11, 20, 12))
    })

    it("keeps its day when the time changes, or takes the day given when it has none", async () => {
        const { atTime } = await import("./date-time")
        expect(atTime(at(2026, 11, 6, 17), "09:15", "2026-11-07")).toBe(at(2026, 11, 6, 9, 15))
        expect(atTime("", "09:15", "2026-11-07")).toBe(at(2026, 11, 7, 9, 15))
        // A time field half typed in says nothing: what was picked stays.
        expect(atTime(at(2026, 11, 6, 17), "", "2026-11-07")).toBe(at(2026, 11, 6, 17))
    })

    it("says a day can't be picked once all of it is before the earliest time allowed", async () => {
        const { endsBefore, isBefore } = await import("./date-time")
        const earliest = at(2026, 11, 6, 15)
        expect(endsBefore("2026-11-05", earliest)).toBe(true)
        expect(endsBefore("2026-11-06", earliest)).toBe(false)
        expect(isBefore(at(2026, 11, 6, 14, 55), earliest)).toBe(true)
        expect(isBefore(at(2026, 11, 6, 15), earliest)).toBe(false)
        expect(isBefore("", earliest)).toBe(false)
    })
})

describe("the date and time field (components/DateTimePicker.tsx)", () => {
    const field = async (props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") => {
        const { default: DateTimePicker } = await import("@/components/DateTimePicker")
        return render(h(DateTimePicker, { label: "Deadline", value: "", onChange: () => {}, ...props }), locale)
    }

    it("is a field: its label, and a button that says the deadline in the page's language", async () => {
        const html = await field({ value: at(2026, 11, 6, 17) })
        expect(html).toContain('class="ui-label">Deadline</label>')
        expect(trigger(html)).toContain('aria-haspopup="dialog"')
        expect(trigger(html)).toContain('aria-expanded="false"')
        expect(spaced(words(html))!.startsWith("6 Nov 2026")).toBe(true)
        expect(spaced(words(await field({ value: at(2026, 11, 6, 17) }, "ar")))!.startsWith("٦ نوفمبر ٢٠٢٦")).toBe(true)
    })

    it("says what to pick when it has none, or a time that names none", async () => {
        expect(words(await field())).toBe(en.select_deadline)
        expect(trigger(await field())).toContain('data-empty="true"')
        expect(words(await field({ value: "next Friday" }))).toBe(en.select_deadline)
        expect(words(await field({}, "ar"))).toBe(ar.select_deadline)
    })

    it("says its deadline once in the browser, as SafeDate's dates do", async () => {
        hydration.done = false
        try {
            expect(words(await field({ value: at(2026, 11, 6, 17) }))).toBe("")
            expect(words(await field())).toBe(en.select_deadline)
        } finally { hydration.done = true }
    })

    it("has what's wrong under it, in the field's red edge", async () => {
        const html = await field({ error: "Pick its deadline" })
        expect(trigger(html)).toContain('data-invalid="true"')
        const described = /aria-describedby="([^"]+)"/.exec(trigger(html))?.[1]
        expect(html).toContain(`<span id="${described}" class="ui-error">Pick its deadline</span>`)
    })

    it("in a table, reads its label out without showing it", async () => {
        expect(await field({ hideLabel: true })).toContain('class="ui-visually-hidden">Deadline</label>')
    })

    it("opens the date fields' calendar, with the time under the days and Done", () => {
        const s = code(PICKER)
        for (const part of ["usePickerKeyboard(", "<CalendarPopup", "<CalendarMonth", "<Field label={t('time_label')}", 'type="time"', 'name="time"', 'autoComplete="off"', "step={300}", "t('done')", "t('deadline_too_soon')"]) {
            expect(s, part).toContain(part)
        }
        // Done looks off and does nothing while the time is too early, but keeps the focus
        // in its place, so Tab still moves through the time's hour and minute.
        expect(s).toContain("aria-disabled={tooEarly || undefined}")
        expect(s).not.toMatch(/<Button[^>]*\sdisabled=/)
    })

    it("keeps the calendar open when a day is picked, for the time", () => {
        const s = code(PICKER)
        const pick = s.slice(s.indexOf("const pick = "), s.indexOf("}", s.indexOf("const pick = ")) + 1)
        expect(pick).toContain("onDay(value, iso)")
        expect(pick).not.toContain("setIsOpen(false)")
    })

    it("draws nothing of its own making", () => {
        const s = code(PICKER)
        for (const gone of ["style=", "isMobile", "innerWidth", "createPortal", "📅", "🕒", "⚠", "linear-gradient", "as any", "toLocale", "month_", "confirm_selection_button", "hour_label", "customTrigger", "asField", "var(--scrim)", "<select"]) {
            expect(s, gone).not.toContain(gone)
        }
    })
})

describe("where a deadline is picked", () => {
    const PAGES = ["app/(dashboard)/dashboard/tasks/new/page.tsx", "app/(dashboard)/dashboard/obligations/new/page.tsx", "components/TaskEditDetailsModal.tsx", "components/BulkTaskReviewModal.tsx"]

    it.each(PAGES)("%s uses the field as it is, with its label", file => {
        const s = readFileSync(file, "utf8")
        const picker = s.slice(s.indexOf("<DateTimePicker"), s.indexOf("/>", s.indexOf("<DateTimePicker")))
        expect(picker).toContain("label={t('deadline_label')}")
        expect(picker).not.toMatch(/\sasField/)
        expect(s).not.toContain("customTrigger")
    })

    it("has a row's deadline in the bulk review as the field, its label shown, with what's wrong under it", () => {
        const s = readFileSync("components/BulkTaskReviewModal.tsx", "utf8")
        const picker = s.slice(s.indexOf("<DateTimePicker"), s.indexOf("/>", s.indexOf("<DateTimePicker")))
        // Among the row's fields, which its Edit opens, as Create task has it (PR 212).
        expect(picker).not.toContain("hideLabel")
        expect(picker).toContain("label={t('deadline_label')}")
        expect(picker).toContain("error={said('deadline')}")
        // Its date in American order, with its seconds, and the calendar emoji, are gone.
        expect(s).not.toContain("📅")
        expect(s).not.toContain("second: 'numeric'")
        expect(s).not.toContain("edit_deadline")
    })
})

describe("its words", () => {
    it("say what to pick without a command in the masculine, and the earliest time in Arabic digits", () => {
        expect(en.select_deadline).toBe("Select deadline")
        expect(ar.select_deadline).toBe("اختيار الموعد النهائي")
        expect(ar.deadline_required).toBe("يُرجى اختيار موعدها النهائي")
        expect(ar.deadline_too_soon).not.toMatch(/[0-9]/)
        expect(en.time_label).toBe("Time")
    })

    it("lose what only the old picker used", () => {
        const gone = ["sun", "mon", "tue", "wed", "thu", "fri", "sat", "month_january", "month_june", "month_december", "hour_label", "minute_label", "am_pm_label", "am", "pm", "confirm_selection_button", "min_selection_error", "edit_deadline"]
        for (const key of gone) {
            expect(key in en, `en.${key}`).toBe(false)
            expect(key in ar, `ar.${key}`).toBe(false)
        }
    })
})
