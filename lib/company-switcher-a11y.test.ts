import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { moveOption } from "@/lib/listbox-keys"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * The Super Admin's company switcher in the header works from the keyboard
 * and tells a screen reader what it is (WAI-ARIA listbox). Before, the opener
 * and every company were divs that only a mouse could use, and the company
 * in view was shown only by colour and a tick.
 */
describe("moving through the companies", () => {
    it("goes one at a time with the arrows, stopping at the ends", () => {
        expect(moveOption(0, "ArrowDown", 3)).toBe(1)
        expect(moveOption(2, "ArrowDown", 3)).toBe(2)
        expect(moveOption(1, "ArrowUp", 3)).toBe(0)
        expect(moveOption(0, "ArrowUp", 3)).toBe(0)
    })

    it("jumps to the first and last with Home and End", () => {
        expect(moveOption(1, "Home", 5)).toBe(0)
        expect(moveOption(1, "End", 5)).toBe(4)
    })

    it("ignores other keys, and an empty list", () => {
        expect(moveOption(1, "a", 3)).toBeNull()
        expect(moveOption(0, "ArrowDown", 0)).toBeNull()
    })
})

describe("the switcher", () => {
    const src = readFileSync("components/DashboardHeader.tsx", "utf8")
    const opener = src.slice(src.indexOf("ref={switcherRef}") - 200, src.indexOf('className="glass sm-select"'))
    const list = src.slice(src.indexOf('role="listbox"'), src.indexOf("</ul>"))

    it("opens from a button that says it opens a list, and whether it is open", () => {
        expect(opener).toContain('<button\n                            type="button"')
        expect(opener).toContain('aria-haspopup="listbox"')
        expect(opener).toContain("aria-expanded={isCompanyDropdownOpen}")
        expect(opener).toContain("onKeyDown={onSwitcherKeyDown}")
    })

    it("is named by the company in view, which phones show only as initials", () => {
        expect(opener).toMatch(/aria-label=\{t\('company_switcher_label' as TranslationKey\)\.replace\('\{name\}'/)
        expect(en.company_switcher_label).toContain("{name}")
        expect(ar.company_switcher_label).toContain("{name}")
    })

    it("lists the companies as options, the one in view selected", () => {
        expect(list).toContain('role="option"')
        expect(list).toContain("aria-selected={selected}")
        expect(list).toContain("onKeyDown={e => onOptionKeyDown(e, i)}")
        expect(list).toMatch(/<svg aria-hidden="true"/)
    })

    it("handles the keys: arrows, Home, End, Enter, Space, Escape, Tab", () => {
        const keys = src.slice(src.indexOf("const onOptionKeyDown"), src.indexOf("const onOptionKeyDown") + 900)
        expect(keys).toContain("moveOption(i, e.key, switcherOptions.length)")
        for (const k of ["'Enter'", "' '", "'Escape'", "'Tab'"]) expect(keys).toContain(`e.key === ${k}`)
        expect(keys).toContain("switcherRef.current?.focus()")
    })

    it("no longer uses divs that only a mouse can use", () => {
        expect(src).not.toContain("onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}")
        expect(src).not.toContain("onClick={() => handleSelectCompany(null)}")
    })
})
