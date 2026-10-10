import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The three date pickers open from a real button, say whether they're open,
 * and use the shared keyboard handling (lib/usePickerKeyboard.ts). Each
 * opened from a clickable <div>, which Tab skips, so a keyboard user
 * couldn't set a deadline or a day off at all (accessibility audit,
 * 4 October 2026, C1).
 */
const PICKERS = ["components/DatePickerSingle.tsx", "components/DateRangePicker.tsx", "components/DateTimePicker.tsx"]

describe.each(PICKERS)("%s", file => {
    const s = readFileSync(file, "utf8")

    it("doesn't open from a clickable div", () => {
        expect(s).not.toMatch(/<div\s+onClick=\{\(\) => setIsOpen\(!isOpen\)\}/)
        expect(s).not.toMatch(/<div\s+onClick=\{toggleOpen\}\s+style/)
    })

    it("opens from a button that says it opens a dialog and whether it's open", () => {
        expect(s).toMatch(/<button\s+type="button"\s+id=\{openerId\}\s+aria-haspopup="dialog"\s+aria-expanded=\{isOpen\}/)
    })

    it("uses the shared keyboard handling for the pop-up, the grid and each day", () => {
        expect(s).toContain("usePickerKeyboard(")
        expect(s).toContain("{...keys.popupProps}")
        expect(s).toContain("{...keys.gridProps}")
        expect(s).toMatch(/\{\.\.\.keys\.dayProps\(/)
    })

    it("names the month buttons", () => {
        expect(s).toContain("calendar_prev_month")
        expect(s).toContain("calendar_next_month")
    })

    it("names each month button for what it does in Arabic too, where the first one goes forward (Codex review of #35)", () => {
        // In Arabic the first button moves to the next month and the second to the previous one.
        expect(s).toMatch(/aria-label=\{t\(locale === 'ar' \? 'calendar_next_month' : 'calendar_prev_month'/)
        expect(s).toMatch(/aria-label=\{t\(locale === 'ar' \? 'calendar_prev_month' : 'calendar_next_month'/)
    })
})
