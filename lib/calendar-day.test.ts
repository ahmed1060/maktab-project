import { describe, it, expect, afterEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { calendarDay } from "./calendar-day"

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
// As the browser has the fields once hydrated: they say their day only there (lib/date-fields.test.ts).
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))

/**
 * A day picked in a form, such as a record's expiry date, shows as that day
 * wherever the browser is (Codex on #82).
 */
describe("a picked calendar day", () => {
    const zone = process.env.TZ
    afterEach(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone })

    it("is the same day in a browser west of UTC", () => {
        process.env.TZ = "America/Los_Angeles"
        // What the picker used to do: midnight UTC, the evening before in Los Angeles.
        expect(new Date("2026-10-20").getDate()).toBe(19)
        const day = calendarDay("2026-10-20")
        expect([day.getFullYear(), day.getMonth() + 1, day.getDate()]).toEqual([2026, 10, 20])
        expect(day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })).toBe("Oct 20, 2026")
    })

    it("is what the date picker shows", () => {
        // Both pickers say their days through lib/calendar-text.ts, which reads each as calendarDay does.
        const words = readFileSync("lib/calendar-text.ts", "utf8")
        expect(words).toContain("dayFormat(locale).format(calendarDay(iso))")
        expect(words).not.toMatch(/new Date\((iso|from|to)\)/)
        expect(readFileSync("components/DatePickerSingle.tsx", "utf8")).toContain("dayText(value, locale)")
    })

    it("is what the date range picker shows, west of UTC too", async () => {
        process.env.TZ = "America/Los_Angeles"
        const { default: DateRangePicker } = await import("@/components/DateRangePicker")
        const html = renderToStaticMarkup(h(DateRangePicker, { dateFrom: "2026-10-01", dateTo: "2026-10-20", onChange: () => {}, label: "Dates" }))
        expect(html).toContain("1–20 Oct 2026")
    })
})

describe("the date picker while its form saves", () => {
    it("can't be opened, so the day shown is the day saved", async () => {
        const { default: DatePickerSingle } = await import("@/components/DatePickerSingle")
        const html = (disabled: boolean) => renderToStaticMarkup(h(DatePickerSingle, { value: "2026-10-20", onChange: () => {}, label: "Expiry date", disabled }))
        expect(html(true)).toMatch(/<button type="button"[^>]*class="ui-input ui-date-trigger"[^>]*disabled="">/)
        expect(html(false)).not.toContain('disabled=""')
        expect(readFileSync("components/records/RecordForm.tsx", "utf8")).toContain("onChange={setExpiryDate} disabled={saving} />")
    })
})
