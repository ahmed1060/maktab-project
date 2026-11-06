import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * A date, or a range of dates (DESIGN.md §5.3): a field whose button opens a
 * calendar drawn as the menus are, under the field on a computer and in the
 * middle of the screen on a phone, in the page's language and digits. The
 * calendar was a window of its own making: the day picked in the info blue,
 * today in the waiting colour, Reset in red, the weekdays typed in, and the
 * dates in American order with Western digits in Arabic.
 */

const ui = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
const render = (el: ReturnType<typeof h>, locale: "en" | "ar" = "en") => { ui.locale = locale; return renderToStaticMarkup(el) }
// Rendered as the browser has it, once hydrated; one test renders as the server does.
const hydration = { done: true }
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => hydration.done }))

const SINGLE = "components/DatePickerSingle.tsx"
const RANGE = "components/DateRangePicker.tsx"
const CALENDAR = "components/ui/Calendar.tsx"
const code = (file: string) => stripComments(readFileSync(file, "utf8"))

/** Runs `check` with the browser's clock in another time zone, then puts it back. */
const inZone = (zone: string, check: () => void) => {
    const was = process.env.TZ
    process.env.TZ = zone
    try { check() } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was }
}

describe("a date's words (lib/calendar-text.ts)", () => {
    it("are the day in the page's language and digits: 6 Nov 2026", async () => {
        const { dayText } = await import("./calendar-text")
        expect(dayText("2026-11-06", "en")).toBe("6 Nov 2026")
        expect(dayText("2026-11-06", "ar")).toBe("٦ نوفمبر ٢٠٢٦")
    })

    it("are the day picked, west of UTC too", async () => {
        const { dayText } = await import("./calendar-text")
        inZone("America/Los_Angeles", () => expect(dayText("2026-11-01", "en")).toBe("1 Nov 2026"))
    })

    it("are a range's days as Intl joins them, and a range of one day as that day", async () => {
        const { rangeText } = await import("./calendar-text")
        const words = { from: en.date_range_from, until: en.date_range_until }
        expect(rangeText("2026-11-06", "2026-11-10", "en", words)).toBe("6–10 Nov 2026")
        expect(rangeText("2026-10-28", "2026-11-03", "en", words)).toBe("28 Oct – 3 Nov 2026")
        expect(rangeText("2026-12-28", "2027-01-03", "en", words)).toBe("28 Dec 2026 – 3 Jan 2027")
        expect(rangeText("2026-11-06", "2026-11-06", "en", words)).toBe("6 Nov 2026")
        expect(rangeText("2026-11-06", "2026-11-10", "ar", { from: ar.date_range_from, until: ar.date_range_until })).toBe("٦–١٠ نوفمبر ٢٠٢٦")
        inZone("America/Los_Angeles", () => expect(rangeText("2026-10-01", "2026-10-20", "en", words)).toBe("1–20 Oct 2026"))
    })

    it("are From or Until when a range has one end only, and none with neither", async () => {
        const { rangeText } = await import("./calendar-text")
        const words = { from: en.date_range_from, until: en.date_range_until }
        expect(rangeText("2026-11-06", "", "en", words)).toBe("From 6 Nov 2026")
        expect(rangeText("", "2026-11-10", "en", words)).toBe("Until 10 Nov 2026")
        expect(rangeText("2026-11-06", "", "ar", { from: ar.date_range_from, until: ar.date_range_until })).toBe("من ٦ نوفمبر ٢٠٢٦")
        expect(rangeText("", "", "en", words)).toBeNull()
    })

    it("read the day of a time given in full, as the dashboard's link to the audit log gives one, and don't throw on one that names no day", async () => {
        // Intl throws on an invalid date, where the old field said "Invalid Date".
        const { dayText, rangeText, dayIso } = await import("./calendar-text")
        const words = { from: en.date_range_from, until: en.date_range_until }
        expect(dayIso("2026-11-02T06:00:00.000Z")).toBe("2026-11-02")
        expect(dayText("2026-11-02T06:00:00.000Z", "en")).toBe("2 Nov 2026")
        expect(rangeText("2026-11-02T06:00:00.000Z", "", "en", words)).toBe("From 2 Nov 2026")
        expect(rangeText("2026-11-02T06:00:00.000Z", "2026-11-05", "en", words)).toBe("2–5 Nov 2026")
        // What names no day is shown as it is, or as no end of a range.
        expect(dayIso("someday")).toBeNull()
        expect(dayIso("2026-02-30")).toBeNull()
        expect(dayText("someday", "en")).toBe("someday")
        expect(rangeText("someday", "", "en", words)).toBeNull()
        expect(rangeText("someday", "2026-11-05", "en", words)).toBe("Until 5 Nov 2026")
    })

    it("put a range given the wrong way round the right way round", async () => {
        // Intl writes "10–6 Nov 2026" for one, as an address can hold it.
        const { rangeText } = await import("./calendar-text")
        expect(rangeText("2026-11-10", "2026-11-06", "en", { from: "", until: "" })).toBe("6–10 Nov 2026")
    })

    it("name the month and its year, and each day in full", async () => {
        const { monthTitle, dayLabel, dayNumber } = await import("./calendar-text")
        expect(monthTitle(new Date(2026, 10, 1), "en")).toBe("November 2026")
        expect(monthTitle(new Date(2026, 10, 1), "ar")).toBe("نوفمبر ٢٠٢٦")
        expect(dayLabel("2026-11-06", "en")).toBe("Friday, 6 November 2026")
        expect(dayLabel("2026-11-06", "ar")).toBe("الجمعة، ٦ نوفمبر ٢٠٢٦")
        expect(dayNumber("2026-11-06", "en")).toBe("6")
        expect(dayNumber("2026-11-06", "ar")).toBe("٦")
    })

    it("give the days of the week from Sunday, by their shortest names and in full", async () => {
        const { weekdays } = await import("./calendar-text")
        expect(weekdays("en").map(d => d.short)).toEqual(["S", "M", "T", "W", "T", "F", "S"])
        expect(weekdays("en").map(d => d.full)).toEqual(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
        expect(weekdays("ar").map(d => d.short)).toEqual(["ح", "ن", "ث", "ر", "خ", "ج", "س"])
        expect(weekdays("ar")[0].full).toBe("الأحد")
        expect(weekdays("ar")[6].full).toBe("السبت")
    })

    it("lay out a month from Sunday: a blank for each day before its first", async () => {
        const { monthCells } = await import("./calendar-text")
        // 1 Nov 2026 is a Sunday; 1 Oct 2026 a Thursday.
        const november = monthCells(new Date(2026, 10, 1))
        expect(november).toHaveLength(30)
        expect(november[0]).toBe("2026-11-01")
        expect(november[29]).toBe("2026-11-30")
        const october = monthCells(new Date(2026, 9, 1))
        expect(october.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"])
        expect(october.filter(Boolean)).toHaveLength(31)
        expect(monthCells(new Date(2027, 1, 1)).filter(Boolean)).toHaveLength(28)
    })
})

describe("where the calendar opens on a computer (lib/calendar-place.ts)", () => {
    const view = { width: 1280, height: 800 }
    const size = { width: 290, height: 330 }
    const field = { top: 200, bottom: 236, left: 100, right: 400 }

    it("is under the field, from its start edge", async () => {
        const { calendarPlace } = await import("./calendar-place")
        expect(calendarPlace(field, size, view, false)).toEqual({ start: 100, top: 240 })
        // In Arabic the start edge is the right one, counted from the screen's right.
        expect(calendarPlace(field, size, view, true)).toEqual({ start: 880, top: 240 })
    })

    it("is above the field when there's no room below", async () => {
        const { calendarPlace } = await import("./calendar-place")
        expect(calendarPlace({ ...field, top: 600, bottom: 636 }, size, view, false)).toEqual({ start: 100, bottom: 204 })
    })

    it("takes the side with more room when it fits on neither", async () => {
        const { calendarPlace } = await import("./calendar-place")
        expect(calendarPlace({ ...field, top: 150, bottom: 186 }, size, { width: 1280, height: 400 }, false)).toEqual({ start: 100, top: 190 })
        expect(calendarPlace({ ...field, top: 250, bottom: 286 }, size, { width: 1280, height: 400 }, false)).toEqual({ start: 100, bottom: 154 })
    })

    it("stays on the screen sideways, 8px in from its edges", async () => {
        const { calendarPlace } = await import("./calendar-place")
        expect(calendarPlace({ ...field, left: 1100, right: 1270 }, size, view, false).start).toBe(982)
        expect(calendarPlace({ ...field, left: 20, right: 200 }, size, view, true).start).toBe(982)
        expect(calendarPlace({ ...field, left: 2, right: 300 }, size, view, false).start).toBe(8)
    })
})

describe("the calendar (components/ui/Calendar.tsx)", () => {
    const keys = {
        popupProps: { ref: { current: null }, role: "dialog", "aria-modal": true, onKeyDown: () => {} },
        gridProps: { onKeyDown: () => {} },
        dayProps: (iso: string, selected: boolean) => ({ "data-date": iso, tabIndex: iso === "2026-11-06" ? 0 : -1, "aria-pressed": selected, onFocus: () => {} }),
        opened: () => {},
    }
    const month = async (locale: "en" | "ar" = "en", look: (iso: string) => { picked?: boolean; inRange?: boolean } = () => ({})) => {
        const { CalendarMonth } = await import("@/components/ui/Calendar")
        return render(h(CalendarMonth, { month: new Date(2026, 10, 1), onMonth: () => {}, today: "2026-11-06", look, onPick: () => {}, keys: keys as never }), locale)
    }

    it("has the month and year at its top, said again as it changes, between the month before and the month after", async () => {
        const html = await month()
        expect(html).toMatch(/<span class="ui-calendar-title" aria-live="polite">November 2026<\/span>/)
        const before = html.indexOf('aria-label="Previous month"'), title = html.indexOf("November 2026"), after = html.indexOf('aria-label="Next month"')
        expect(before).toBeGreaterThan(-1)
        expect(before).toBeLessThan(title)
        expect(title).toBeLessThan(after)
        // Each a quiet small button with a caret that turns round in Arabic.
        expect(html.match(/<button type="button" class="ui-btn ui-btn-quiet ui-btn-sm ui-calendar-step"/g)).toHaveLength(2)
        expect(html.match(/ui-flip/g)).toHaveLength(2)
    })

    it("has the month before on the start side in Arabic too, so the next month is on the left", async () => {
        const html = await month("ar")
        const before = html.indexOf(`aria-label="${ar.calendar_prev_month}"`), title = html.indexOf("نوفمبر ٢٠٢٦"), after = html.indexOf(`aria-label="${ar.calendar_next_month}"`)
        expect(before).toBeGreaterThan(-1)
        expect(before).toBeLessThan(title)
        expect(title).toBeLessThan(after)
    })

    it("names the days of the week by their shortest names, and in full for a screen reader", async () => {
        const html = await month()
        expect(html).toContain('<div class="ui-calendar-weekdays"><span><span aria-hidden="true">S</span><span class="ui-visually-hidden">Sunday</span></span>')
        const arabic = await month("ar")
        expect(arabic).toContain('<span aria-hidden="true">ح</span><span class="ui-visually-hidden">الأحد</span>')
    })

    it("has a button for each day, in the page's digits, read out as the whole date", async () => {
        const html = await month()
        expect(html.match(/class="ui-calendar-day"/g)).toHaveLength(30)
        expect(html).toMatch(/<button type="button" data-date="2026-11-07" tabindex="-1" aria-pressed="false" class="ui-calendar-day" aria-label="Saturday, 7 November 2026">7<\/button>/)
        const arabic = await month("ar")
        expect(arabic).toContain('aria-label="السبت، ٧ نوفمبر ٢٠٢٦">٧</button>')
        expect(arabic).not.toMatch(/class="ui-calendar-day"[^>]*>7</)
    })

    it("marks today, read out as today, the day picked and a range's days", async () => {
        const html = await month("en", iso => ({ picked: iso === "2026-11-10" || iso === "2026-11-14", inRange: iso > "2026-11-10" && iso < "2026-11-14" }))
        expect(html).toMatch(/data-date="2026-11-06"[^>]*data-today="true" aria-current="date"/)
        expect(html).toMatch(/data-date="2026-11-10"[^>]*aria-pressed="true" class="ui-calendar-day" data-picked="true"/)
        expect(html.match(/data-in-range="true"/g)).toHaveLength(3)
        expect(html.match(/aria-current="date"/g)).toHaveLength(1)
    })

    it("lays out a month that starts midweek with blanks before its first day", async () => {
        const { CalendarMonth } = await import("@/components/ui/Calendar")
        const html = render(h(CalendarMonth, { month: new Date(2026, 9, 1), onMonth: () => {}, today: "2026-11-06", look: () => ({}), onPick: () => {}, keys: keys as never }))
        expect(html).toMatch(/<div class="ui-calendar-days"><span aria-hidden="true"><\/span><span aria-hidden="true"><\/span><span aria-hidden="true"><\/span><span aria-hidden="true"><\/span><button/)
    })

    it("uses the shared keyboard handling, opens on the page's body, and is placed against its field", () => {
        const s = code(CALENDAR)
        expect(s).toContain("{...keys.popupProps}")
        expect(s).toContain("{...keys.gridProps}")
        expect(s).toMatch(/\{\.\.\.keys\.dayProps\(/)
        expect(s).toContain("createPortal(")
        expect(s).toContain("document.body")
        expect(s).toContain("calendarPlace(")
        expect(s).toContain("'--calendar-start'")
        // Follows its field as the page scrolls or the window changes size.
        expect(s).toMatch(/addEventListener\('scroll', [a-z]+, true\)/)
        expect(s).toMatch(/addEventListener\('resize', [a-z]+\)/)
        // A click elsewhere closes it; on a phone, a tap on the dimmed page does, without reaching what's under it.
        expect(s).toMatch(/addEventListener\('pointerdown', [a-z]+\)/)
        expect(s).toContain("e.target === e.currentTarget")
        expect(s).not.toContain("style=")
    })
})

describe("the date fields", () => {
    const words = (html: string) => html.match(/<button[^>]*class="ui-input ui-date-trigger"[^>]*>([^<]*)<\/button>/)?.[1]
    const trigger = (html: string) => html.match(/<button[^>]*class="ui-input ui-date-trigger"[^>]*>/)?.[0] ?? ""

    it("show a day in the page's language, or what to pick", async () => {
        const { default: DatePickerSingle } = await import("@/components/DatePickerSingle")
        const field = (value: string, locale: "en" | "ar" = "en") => render(h(DatePickerSingle, { label: "Payment date", value, onChange: () => {} }), locale)
        expect(words(field("2026-11-06"))).toBe("6 Nov 2026")
        expect(words(field("2026-11-06", "ar"))).toBe("٦ نوفمبر ٢٠٢٦")
        expect(words(field(""))).toBe(en.select_date)
        expect(trigger(field(""))).toContain('data-empty="true"')
        expect(field("2026-11-06")).toContain('class="ui-label">Payment date</label>')
    })

    it("show a range as Intl joins it, or what to pick", async () => {
        const { default: DateRangePicker } = await import("@/components/DateRangePicker")
        const field = (dateFrom: string, dateTo: string, locale: "en" | "ar" = "en") => render(h(DateRangePicker, { label: "Dates", dateFrom, dateTo, onChange: () => {} }), locale)
        expect(words(field("2026-11-06", "2026-11-10"))).toBe("6–10 Nov 2026")
        expect(words(field("2026-11-06", "2026-11-10", "ar"))).toBe("٦–١٠ نوفمبر ٢٠٢٦")
        expect(words(field("2026-11-06", ""))).toBe("From 6 Nov 2026")
        expect(words(field("", "2026-11-10"))).toBe("Until 10 Nov 2026")
        expect(words(field("", ""))).toBe(en.select_date_range)
        expect(trigger(field("", ""))).toContain('data-empty="true"')
        expect(trigger(field("", "2026-11-10"))).not.toContain("data-empty")
    })

    it("show a range's day from a time given in full, as the audit log's address can hold", async () => {
        const { default: DateRangePicker } = await import("@/components/DateRangePicker")
        const html = render(h(DateRangePicker, { label: "Dates", dateFrom: "2026-11-02T06:00:00.000Z", dateTo: "", onChange: () => {} }))
        expect(words(html)).toBe("From 2 Nov 2026")
        // And open on that day's month: what the field starts from is a day.
        expect(code(RANGE)).toContain("startDay(dayIso(dateFrom),")
        expect(code(SINGLE)).toContain("startDay(dayIso(value),")
    })

    it("say their day once in the browser, whose Intl can write it otherwise than the server's", async () => {
        // The server wrote «٢–٥ نوفمبر ٢٠٢٦» and the browser «٢–٥ نوفمبر، ٢٠٢٦»,
        // and React drew the page again (hydration), as SafeDate already avoids.
        const { default: DatePickerSingle } = await import("@/components/DatePickerSingle")
        const { default: DateRangePicker } = await import("@/components/DateRangePicker")
        hydration.done = false
        try {
            const day = render(h(DatePickerSingle, { label: "Date", value: "2026-11-06", onChange: () => {} }), "ar")
            const range = render(h(DateRangePicker, { label: "Dates", dateFrom: "2026-11-02", dateTo: "2026-11-05", onChange: () => {} }), "ar")
            expect([words(day), words(range)]).toEqual(["", ""])
            expect([trigger(day), trigger(range)].map(b => b.includes("data-empty"))).toEqual([false, false])
            // What to pick is the same words on both, so it's there from the start.
            expect(words(render(h(DateRangePicker, { label: "Dates", dateFrom: "", dateTo: "", onChange: () => {} })))).toBe(en.select_date_range)
        } finally {
            hydration.done = true
        }
        for (const file of [SINGLE, RANGE]) expect(code(file), file).toContain("useHydrated()")
    })

    it("show what's wrong in the field's colour, as a field does", async () => {
        const { default: DatePickerSingle } = await import("@/components/DatePickerSingle")
        const { default: DateRangePicker } = await import("@/components/DateRangePicker")
        expect(trigger(render(h(DatePickerSingle, { label: "Date", value: "", onChange: () => {}, error: "Pick a day" })))).toContain('data-invalid="true"')
        expect(trigger(render(h(DateRangePicker, { label: "Dates", dateFrom: "", dateTo: "", onChange: () => {}, error: "Pick the days" })))).toContain('data-invalid="true"')
        expect(trigger(render(h(DatePickerSingle, { label: "Date", value: "", onChange: () => {} })))).not.toContain("data-invalid")
    })

    it("let a range be turned off and given a hint, as a day can", async () => {
        const { default: DateRangePicker } = await import("@/components/DateRangePicker")
        const html = render(h(DateRangePicker, { label: "Dates", dateFrom: "", dateTo: "", onChange: () => {}, disabled: true, hint: "Up to 30 days." }))
        expect(trigger(html)).toContain('disabled=""')
        const id = trigger(html).match(/aria-describedby="([^"]+)"/)?.[1]
        expect(id).toBeTruthy()
        expect(html).toContain(`<span id="${id}" class="ui-hint">Up to 30 days.</span>`)
    })

    it("keep a filter bar's label for screen readers only", async () => {
        const { default: DateRangePicker } = await import("@/components/DateRangePicker")
        const html = render(h(DateRangePicker, { label: "Dates", hideLabel: true, dateFrom: "", dateTo: "", onChange: () => {} }))
        expect(html).toMatch(/<label for="[^"]+" class="ui-visually-hidden">Dates<\/label>/)
    })

    it.each([SINGLE, RANGE])("%s opens the calendar building block, with nothing of its own making", file => {
        const s = code(file)
        expect(s).toContain("usePickerKeyboard(")
        expect(s).toContain("<CalendarPopup")
        expect(s).toContain("<CalendarMonth")
        expect(s).not.toContain("asField")
        for (const made of ["style=", "isMobile", "innerWidth", "as any", "'Done'", "'تم'", "📅", "▲", "▼", "→", "toLocaleDateString(", "createPortal", "var(--scrim)", "weekdaysAr"]) {
            expect(s, made).not.toContain(made)
        }
    })

    it("the range starts again each time it opens", () => {
        const s = code(RANGE)
        const opening = s.slice(s.indexOf("const toggleOpen"), s.indexOf("}", s.indexOf("const toggleOpen")))
        expect(opening).toContain("setFirst(null)")
    })

    it("are drawn with no old look anywhere: no page passes asField to them", () => {
        const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
        const passing = [...files("app"), ...files("components")].filter(f => /<(DatePickerSingle|DateRangePicker)\b[^>]*\basField\b/.test(readFileSync(f, "utf8")))
        expect(passing).toEqual([])
    })
})

describe("closing the calendar gives the focus back to its field", () => {
    it("when the focus was in it, not when a click outside moved it on", async () => {
        const { returnsFocus } = await import("./focus-trap")
        const body = { isConnected: true }
        expect(returnsFocus(body, body)).toBe(true)
        expect(returnsFocus(null, body)).toBe(true)
        // A day's button, gone with the calendar.
        expect(returnsFocus({ isConnected: false }, body)).toBe(true)
        // Another field, clicked while it was open.
        expect(returnsFocus({ isConnected: true }, body)).toBe(false)
        expect(code("lib/usePickerKeyboard.ts")).toContain("returnsFocus(document.activeElement, document.body)")
    })
})

describe("its look", () => {
    const raw = readFileSync("components/ui/ui.css", "utf8")
    const block = stripComments(raw.slice(raw.indexOf("/* ── A date, or a range of dates (§5.3) ──"), raw.indexOf("/* end of the date fields */")))
    const phone = block.slice(block.indexOf("@media (max-width: 767px)"))
    const rule = (selector: string, from = block) => {
        const at = from.indexOf(`\n${selector} {`)
        expect(at, `no ${selector} rule`).toBeGreaterThan(-1)
        return from.slice(at, from.indexOf("}", at))
    }

    it("is a menu's, opening against its field", () => {
        expect(block.length).toBeGreaterThan(100)
        const popup = rule(".ui-calendar")
        for (const part of ["position: fixed", "inset-inline-start: var(--calendar-start", "top: var(--calendar-top", "bottom: var(--calendar-bottom",
            "background: var(--panel-raised)", "border: 1px solid var(--rule)", "border-radius: var(--radius-menu)", "box-shadow: var(--elev-2)"]) {
            expect(popup, part).toContain(part)
        }
        // On a computer the layer under it is nothing: a click goes through to the page.
        expect(rule(".ui-calendar-layer")).toContain("display: contents")
    })

    it("has 36px days, the day picked in the brand colour, today in its text colour, and a range's days on its tint", () => {
        const day = rule(".ui-calendar-day")
        expect(day).toContain("width: 36px")
        expect(day).toContain("height: 36px")
        expect(rule('.ui-calendar-day[data-picked]')).toMatch(/background: var\(--brand\);[\s\S]*color: var\(--on-brand\)/)
        expect(rule('.ui-calendar-day[data-today]')).toMatch(/color: var\(--brand-text\);[\s\S]*font-weight: 600/)
        expect(rule('.ui-calendar-day[data-in-range]')).toMatch(/background: var\(--brand-tint\);[\s\S]*color: var\(--brand-text\)/)
        expect(rule('.ui-calendar-day[aria-disabled="true"]')).toContain("color: var(--muted)")
        expect(rule(".ui-calendar-day:focus-visible")).toContain("outline: 2px solid var(--brand-text)")
        expect(rule(".ui-calendar-days")).toContain("font-variant-numeric: tabular-nums")
    })

    it("is in the middle of a phone's screen over the dimmed page, with 44px days", () => {
        expect(phone.length).toBeGreaterThan(0)
        const layer = rule("  .ui-calendar-layer", phone)
        expect(layer).toContain("position: fixed")
        expect(layer).toContain("background: var(--scrim)")
        expect(rule("  .ui-calendar-day", phone)).toContain("height: 44px")
        expect(rule("  .ui-calendar-step", phone)).toContain("width: 44px")
    })

    it("is written with logical properties and tokens only", () => {
        expect(block).not.toMatch(/(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/m)
        expect(block).not.toMatch(/text-align:\s*(left|right)/)
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    })

    it("acts on a tap at once", () => {
        // The month buttons are buttons of the building blocks, which do already.
        const taps = stripComments(raw).slice(0, stripComments(raw).indexOf("touch-action: manipulation"))
        expect(taps).toContain(".ui-calendar-day,")
        expect(taps).toContain(".ui-btn,")
    })
})

describe("its words", () => {
    it("are Clear, From and Until, in both languages", () => {
        expect([en.date_clear, ar.date_clear]).toEqual(["Clear", "مسح"])
        expect([en.date_range_from, ar.date_range_from]).toEqual(["From {date}", "من {date}"])
        expect([en.date_range_until, ar.date_range_until]).toEqual(["Until {date}", "حتى {date}"])
    })

    it("ask, in Arabic, without a command in the masculine", () => {
        for (const key of ["select_date", "select_date_range", "select_start_date", "select_end_date"] as const) {
            expect(ar[key], key).not.toMatch(/^اختر/)
        }
        expect(ar.select_date).toBe("اختيار تاريخ")
        expect(ar.select_start_date).toBe("يُرجى اختيار تاريخ البدء")
    })

    it("have no Reset any more: Clear empties the field, and it isn't red", () => {
        expect("reset" in en).toBe(false)
        expect("reset" in ar).toBe(false)
    })
})
