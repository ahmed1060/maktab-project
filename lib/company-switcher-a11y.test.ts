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
    // The company picker since the top bar moved onto the building blocks
    // (PR 206): its markup is checked in lib/company-picker.test.ts, and what
    // it guarantees a keyboard and a screen reader is held here too.
    const src = readFileSync("components/CompanyPicker.tsx", "utf8")
    const opener = src.slice(src.indexOf("export function CompanyPickerButton"), src.indexOf("export function CompanyPickerPanel"))
    const list = src.slice(src.indexOf('role="listbox"'), src.indexOf('className="ui-company-picker-none"'))

    it("opens from a button that says it opens a list, and whether it is open", () => {
        expect(opener).toMatch(/<button type="button"/)
        expect(opener).toContain('aria-haspopup="listbox"')
        expect(opener).toContain("aria-expanded={open}")
        expect(opener).toContain("onKeyDown={onKeyDown}")
        expect(src).toContain("onKeyDown={onButtonKeyDown}")
    })

    it("is named by the company in view, which phones show only as initials", () => {
        expect(opener).toContain("aria-label={t('company_switcher_label').replace('{name}', () => inView.name)}")
        expect(en.company_switcher_label).toContain("{name}")
        expect(ar.company_switcher_label).toContain("{name}")
    })

    it("lists the companies as options, the one the keys are on selected, from a field that keeps the focus", () => {
        expect(list).toContain('role="option"')
        expect(list).toContain("aria-selected={i === active}")
        expect(src).toContain('role="combobox"')
        expect(src).toContain("aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}")
    })

    it("handles the keys: the arrows, Enter, Escape, and Tab out of it", () => {
        const keys = src.slice(src.indexOf("const onInputKeyDown"), src.indexOf("const onInputKeyDown") + 500)
        expect(keys).toContain("moveActive(active, e.key, options.length)")
        expect(keys).toContain("e.key === 'Enter'")
        // Escape from anywhere in it, on its box.
        expect(src).toContain("onKeyDown={e => { if (e.key === 'Escape' && open) {")
        expect(src).toContain("const close = () => { setOpen(false); buttonRef.current?.focus() }")
        expect(src).toMatch(/onBlur=\{e => \{ if \(e\.relatedTarget && !box\.current\?\.contains\(e\.relatedTarget as Node\)\) setOpen\(false\) \}\}/)
    })

    it("no longer uses divs that only a mouse can use", () => {
        const header = readFileSync("components/DashboardHeader.tsx", "utf8")
        expect(header).not.toContain("onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}")
        expect(header).not.toContain("onClick={() => handleSelectCompany(null)}")
    })
})
