import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The three date pickers open from a real button, say whether they're open,
 * and use the shared keyboard handling (lib/usePickerKeyboard.ts). Each
 * opened from a clickable <div>, which Tab skips, so a keyboard user
 * couldn't set a deadline or a day off at all (accessibility audit,
 * 4 October 2026, C1).
 *
 * The date and the date range fields open the calendar building block
 * (components/ui/Calendar.tsx, PR 208), which draws the pop-up, its grid and
 * its days with the shared props. The date and time picker still draws its own.
 */
const PICKERS = ["components/DatePickerSingle.tsx", "components/DateRangePicker.tsx", "components/DateTimePicker.tsx"]
const CALENDAR = "components/ui/Calendar.tsx"
/** Where a picker's pop-up, grid and days are drawn. */
const drawnIn = (file: string) => (file === "components/DateTimePicker.tsx" ? file : CALENDAR)

describe.each(PICKERS)("%s", file => {
    const s = readFileSync(file, "utf8")
    const drawn = readFileSync(drawnIn(file), "utf8")

    it("doesn't open from a clickable div", () => {
        expect(s).not.toMatch(/<div\s+onClick=\{\(\) => setIsOpen\(!isOpen\)\}/)
        expect(s).not.toMatch(/<div\s+onClick=\{toggleOpen\}\s+style/)
    })

    it("opens from a button that says it opens a dialog and whether it's open", () => {
        expect(s).toMatch(/<button\s+type="button"\s+id=\{openerId\}\s+aria-haspopup="dialog"\s+aria-expanded=\{isOpen\}/)
    })

    it("uses the shared keyboard handling for the pop-up, the grid and each day", () => {
        expect(s).toContain("usePickerKeyboard(")
        expect(drawn).toContain("{...keys.popupProps}")
        expect(drawn).toContain("{...keys.gridProps}")
        expect(drawn).toMatch(/\{\.\.\.keys\.dayProps\(/)
    })

    it("names the month buttons", () => {
        expect(drawn).toContain("calendar_prev_month")
        expect(drawn).toContain("calendar_next_month")
    })
})

describe("components/DateTimePicker.tsx", () => {
    it("names each month button for what it does in Arabic too, where the first one goes forward (Codex review of #35)", () => {
        // In Arabic the first button moves to the next month and the second to the previous one.
        const s = readFileSync("components/DateTimePicker.tsx", "utf8")
        expect(s).toMatch(/aria-label=\{t\(locale === 'ar' \? 'calendar_next_month' : 'calendar_prev_month'/)
        expect(s).toMatch(/aria-label=\{t\(locale === 'ar' \? 'calendar_prev_month' : 'calendar_next_month'/)
    })
})

describe("the calendar building block", () => {
    it("names each month button for what it does, the month before first, on the start side, in Arabic too (DESIGN.md §5.3)", () => {
        // As the pager's previous page is: in Arabic, the next month is on the left, the way the days run.
        const s = readFileSync(CALENDAR, "utf8")
        expect(s).toMatch(/aria-label=\{t\('calendar_prev_month'\)\} onClick=\{\(\) => step\(-1\)\}/)
        expect(s).toMatch(/aria-label=\{t\('calendar_next_month'\)\} onClick=\{\(\) => step\(1\)\}/)
        expect(s.indexOf("t('calendar_prev_month')")).toBeLessThan(s.indexOf("t('calendar_next_month')"))
        expect(s).not.toContain("locale === 'ar' ? 'calendar_")
    })
})
