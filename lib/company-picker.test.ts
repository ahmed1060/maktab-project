import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * The Super Admin's company picker on the top bar (DESIGN.md §5.1), as the
 * mock-up of the app's frame the product owner approved on 2026-11-05 draws
 * it: the company in view on a pill, with its initials, and a panel with a
 * search of its own above the companies.
 */

const ui = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const render = (el: ReturnType<typeof h>, locale: "en" | "ar" = "en") => { ui.locale = locale; return renderToStaticMarkup(el) }
const raw = readFileSync("components/ui/ui.css", "utf8")
const css = stripComments(raw)
// The picker's own rules, from its first to the marker at their end.
const block = stripComments(raw.slice(raw.indexOf("\n.ui-company-picker {"), raw.indexOf("/* end of the company picker */")))
const rule = (selector: string, from = css) => {
    const at = from.indexOf(`\n${selector} {`)
    expect(at, `no ${selector} rule`).toBeGreaterThan(-1)
    return from.slice(at, from.indexOf("}", at))
}
const PICKER = "components/CompanyPicker.tsx"
const source = () => stripComments(readFileSync(PICKER, "utf8"))
const header = stripComments(readFileSync("components/DashboardHeader.tsx", "utf8"))
const companies = [{ id: "c1", name: "Nile Works" }, { id: "c2", name: "Delta Foods" }, { id: "c3", name: "شركة الدلتا" }]
const ALL = { id: null, name: en.all_companies }

describe("what the list holds", () => {
    it("is All companies and then every company, with nothing typed", async () => {
        const { pickerOptions } = await import("@/components/CompanyPicker")
        expect(pickerOptions(companies, "", en.all_companies)).toEqual([ALL, ...companies])
        expect(pickerOptions(companies, "   ", en.all_companies)).toEqual([ALL, ...companies])
    })

    it("keeps the companies whose names have what's typed in them, capitals or not, without All companies", async () => {
        const { pickerOptions } = await import("@/components/CompanyPicker")
        expect(pickerOptions(companies, "nile", en.all_companies)).toEqual([companies[0]])
        expect(pickerOptions(companies, " FOOD ", en.all_companies)).toEqual([companies[1]])
        expect(pickerOptions(companies, "de", en.all_companies)).toEqual([companies[1]])
        expect(pickerOptions(companies, "الدلتا", en.all_companies)).toEqual([companies[2]])
        expect(pickerOptions(companies, "all", en.all_companies)).toEqual([])
    })
})

describe("the arrows in the search field", () => {
    it("move one row at a time, stopping at the ends", async () => {
        const { moveActive } = await import("@/components/CompanyPicker")
        expect(moveActive(0, "ArrowDown", 3)).toBe(1)
        expect(moveActive(2, "ArrowDown", 3)).toBe(2)
        expect(moveActive(1, "ArrowUp", 3)).toBe(0)
        expect(moveActive(0, "ArrowUp", 3)).toBe(0)
    })

    it("leave Home, End and every other key to what's typed", async () => {
        const { moveActive } = await import("@/components/CompanyPicker")
        for (const key of ["Home", "End", "a", "ArrowLeft", "ArrowRight"]) expect(moveActive(1, key, 3), key).toBeNull()
        expect(moveActive(0, "ArrowDown", 0)).toBeNull()
    })
})

describe("the picker", () => {
    const button = async (inView: { id: string | null; name: string }, locale: "en" | "ar" = "en", open = false) => {
        const { CompanyPickerButton } = await import("@/components/CompanyPicker")
        return render(h(CompanyPickerButton, { inView, open, listId: "l1", onToggle: () => {}, onKeyDown: () => {} }), locale)
    }

    it("is a pill with the company's initials, Company in view over its name, and a caret, named with both", async () => {
        const html = await button(companies[0])
        expect(html).toContain('<button type="button" class="ui-company-picker-button" aria-haspopup="listbox" aria-expanded="false" aria-label="Company in view: Nile Works">')
        expect(html).toContain('<span class="ui-company-tile ui-company-tile-32" aria-hidden="true">NW</span>')
        expect(html).toContain('<span class="ui-company-picker-who"><span class="ui-company-picker-label">Company in view</span><span class="ui-company-picker-name"><bdi>Nile Works</bdi></span></span>')
        expect(html).toMatch(/<svg[^>]*class="ui-icon ui-company-picker-caret"/)
    })

    it("has the buildings icon for All companies, and says when its list is open", async () => {
        const html = await button({ id: null, name: en.all_companies }, "en", true)
        expect(html).toContain('aria-expanded="true" aria-controls="l1" aria-label="Company in view: All companies"')
        expect(html).toMatch(/<span class="ui-company-tile ui-company-tile-32" aria-hidden="true"><svg[^>]*class="ui-icon"/)
    })

    it("is named in Arabic, a name with $ in it kept as typed", async () => {
        expect(await button(companies[2], "ar")).toContain(`aria-label="${ar.company_switcher_label.replace("{name}", "شركة الدلتا")}"`)
        expect(await button({ id: "c9", name: "A$&B" })).toContain('aria-label="Company in view: A$&amp;B"')
    })
})

describe("its panel", () => {
    const panel = async (props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") => {
        const { CompanyPickerPanel, pickerOptions } = await import("@/components/CompanyPicker")
        const query = (props.query as string) ?? ""
        return render(h(CompanyPickerPanel, {
            inputId: "i1", listId: "l1", query, onQuery: () => {}, options: pickerOptions(companies, query, (locale === "ar" ? ar : en).all_companies),
            active: 1, inViewId: "c1", onActive: () => {}, onPick: () => {}, onKeyDown: () => {}, ...props,
        }), locale)
    }

    it("has Find a company over a search field that keeps the focus and points at the row the arrows are on", async () => {
        const html = await panel()
        expect(html).toContain('<label for="i1" class="ui-company-picker-find">Find a company</label>')
        expect(html).toContain('<input class="ui-input" type="search" id="i1" role="combobox" aria-expanded="true" aria-controls="l1" aria-autocomplete="list" aria-activedescendant="l1-1" autoComplete="off" spellCheck="false" placeholder="Name of a company…" value=""/>')
    })

    it("lists All companies and every company with its tile, the one in view marked with a check", async () => {
        const html = await panel()
        expect(html).toContain('<div id="l1" role="listbox" aria-label="Companies" class="ui-company-picker-list">')
        expect(html).toMatch(/<div id="l1-0" role="option" aria-selected="false" class="ui-company-picker-option"><span class="ui-company-tile" aria-hidden="true"><svg/)
        expect(html).toMatch(/<div id="l1-1" role="option" aria-selected="true" aria-current="true" class="ui-company-picker-option" data-in-view="true"><span class="ui-company-tile" aria-hidden="true">NW<\/span><span class="ui-company-picker-option-name"><bdi>Nile Works<\/bdi><\/span><svg[^>]*class="ui-icon ui-company-picker-check"/)
        expect(html).toContain('<div id="l1-2" role="option" aria-selected="false" class="ui-company-picker-option"><span class="ui-company-tile" aria-hidden="true">DF</span><span class="ui-company-picker-option-name"><bdi>Delta Foods</bdi></span></div>')
        expect(html.match(/ui-company-picker-check/g)).toHaveLength(1)
        expect(html.match(/aria-current/g)).toHaveLength(1)
    })

    it("says when no company has that name, outside the list, as it changes", async () => {
        const html = await panel({ query: "zzz", active: 0 })
        expect(html).not.toContain('role="option"')
        expect(html).not.toContain("aria-activedescendant")
        expect(html).toContain('<p class="ui-company-picker-none" role="status">No company has that name</p>')
        expect(await panel()).toContain('<p class="ui-company-picker-none" role="status"></p>')
    })

    it("is in Arabic, initials kept apart", async () => {
        const html = await panel({ active: 3, inViewId: null }, "ar")
        expect(html).toContain(`>${ar.find_company}</label>`)
        expect(html).toContain(`placeholder="${ar.find_company_placeholder}"`)
        expect(html).toContain(`aria-label="${ar.companies}"`)
        expect(html).toContain('<span class="ui-company-tile" aria-hidden="true">ش‌ا</span>')
    })
})

describe("how it opens, moves and closes", () => {
    it("opens with the focus in the search field, on the company in view", () => {
        const src = source()
        expect(src).toContain("useEffect(() => { if (open && !tapped.current) inputRef.current?.focus() }, [open])")
        expect(src).toMatch(/const openPanel = \(\) => \{ setQuery\(''\); setActive\(Math\.max\(0, all\.findIndex\(o => o\.id === inViewId\)\)\); setOpen\(true\) \}/)
    })

    it("opens from the picker with the down and up arrows too", () => {
        expect(source()).toMatch(/if \(e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'\) \{ e\.preventDefault\(\); openPanel\(\) \}/)
    })

    it("opens from a tap without the keyboard, which would cover the list, and from a key with it", () => {
        const src = source()
        expect(src).toContain("onPointerDown={e => { tapped.current = e.pointerType === 'touch' }}")
        expect(src).toMatch(/const onButtonKeyDown = \(e: KeyboardEvent<HTMLButtonElement>\) => \{\s*tapped\.current = false/)
        expect(src).toMatch(/onClick=\{onToggle\} onKeyDown=\{onKeyDown\} onPointerDown=\{onPointerDown\}/)
    })

    it("starts the arrows on the first company that matches what's typed", () => {
        expect(source()).toContain("onQuery={q => { setQuery(q); setActive(0) }}")
    })

    it("picks with Enter, closes with Escape from anywhere in it, and gives the focus back to the picker either way", () => {
        const src = source()
        expect(src).toMatch(/if \(e\.key === 'Enter' && options\[active\]\) \{ e\.preventDefault\(\); pick\(options\[active\]\.id\) \}/)
        // On the picker's box, so it works with the focus on the picker too, as after a tap.
        expect(src).toMatch(/<div ref=\{box\} className="ui-company-picker"\s+onKeyDown=\{e => \{ if \(e\.key === 'Escape' && open\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); close\(\) \} \}\}/)
        expect(src.match(/'Escape'/g)).toHaveLength(1)
        expect(src).toMatch(/const pick = \(id: string \| null\) => \{ onPick\(id\); close\(\) \}/)
        expect(src).toMatch(/const close = \(\) => \{ setOpen\(false\); buttonRef\.current\?\.focus\(\) \}/)
    })

    it("closes on a click outside it, and when the focus leaves it, Tab out of the search field included", () => {
        const src = source()
        expect(src).toContain("document.addEventListener('pointerdown', outside)")
        expect(src).toMatch(/onBlur=\{e => \{ if \(e\.relatedTarget && !box\.current\?\.contains\(e\.relatedTarget as Node\)\) setOpen\(false\) \}\}/)
    })

    it("keeps the focus in the search field when a row is clicked, and moves the row with the pointer", () => {
        const src = source()
        expect(src).toContain("onMouseDown={e => e.preventDefault()}")
        expect(src).toContain("onMouseMove={() => onActive(i)}")
        expect(src).toContain("onClick={() => onPick(o.id)}")
    })

    it("keeps the row the arrows are on in sight as the list scrolls", () => {
        expect(source()).toContain("document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })")
    })
})

describe("its look", () => {
    it("is a 44px pill on --panel, with an edge of the brand colour at a third", () => {
        const b = rule(".ui-company-picker-button")
        for (const part of ["min-block-size: 44px;", "border: 1px solid color-mix(in srgb, var(--brand) 33%, var(--panel));", "border-radius: var(--radius-pill);", "background: var(--panel);", "color: var(--ink);"]) expect(b, part).toContain(part)
        expect(rule(".ui-company-picker-label")).toContain("color: var(--ink-2);")
        expect(rule(".ui-company-picker-label")).toContain("font-size: var(--text-xs);")
    })

    it("has 28px tiles, 32px on the picker, in the brand's tint where they're the company in view", () => {
        expect(rule(".ui-company-tile")).toContain("inline-size: 28px;")
        expect(rule(".ui-company-tile")).toContain("background: var(--status-neutral-bg);")
        expect(rule(".ui-company-tile")).toContain("color: var(--status-neutral-fg);")
        expect(rule(".ui-company-tile-32")).toContain("inline-size: 32px;")
        expect(rule(".ui-company-tile-32")).toContain("border-radius: var(--radius-menu);")
        expect(rule(".ui-company-tile")).toContain("border-radius: var(--radius-field);")
        expect(css).toMatch(/\n\.ui-company-picker-button \.ui-company-tile,\s*\.ui-company-picker-option\[data-in-view\] \.ui-company-tile \{\s*background: var\(--brand-tint-strong\);\s*color: var\(--brand-text\);/)
    })

    it("has a 320px panel under the bar, as the menus are drawn", () => {
        const p = rule(".ui-company-picker-panel")
        for (const part of ["inline-size: 320px;", "background: var(--panel-raised);", "border: 1px solid var(--rule);", "border-radius: var(--radius-menu);", "box-shadow: var(--elev-2);", "inset-inline-start: 0;"]) expect(p, part).toContain(part)
        expect(rule(".ui-company-picker-find")).toContain("color: var(--muted);")
    })

    it("shows 8 rows of 40px and scrolls past that, the one in view and the one the arrows are on marked", () => {
        // 8 rows, fewer on a short screen, a phone held sideways, so the last isn't under its edge.
        expect(rule(".ui-company-picker-list")).toContain("max-block-size: min(320px, calc(100vh - 180px));")
        expect(rule(".ui-company-picker-list")).toContain("overflow-y: auto;")
        expect(rule(".ui-company-picker-option")).toContain("min-block-size: 40px;")
        expect(rule('.ui-company-picker-option[data-in-view]')).toContain("background: var(--brand-tint);")
        expect(rule('.ui-company-picker-option[data-in-view]')).toContain("color: var(--brand-text);")
        expect(rule('.ui-company-picker-option[aria-selected="true"]')).toContain("background: var(--brand-tint);")
        expect(rule('.ui-company-picker-option[aria-selected="true"]')).not.toContain("box-shadow")
        // Its ring while the focus is in the panel: after a tap, no row is the arrows' yet.
        expect(rule('.ui-company-picker-panel:focus-within .ui-company-picker-option[aria-selected="true"]')).toContain("box-shadow: inset 0 0 0 2px var(--brand-text);")
    })

    it("is its tile alone on a phone, its panel across the bar, 8px in from its edges", () => {
        expect(block.length).toBeGreaterThan(100)
        const phone = block.slice(block.indexOf("@media (max-width: 1023px)"))
        expect(phone).toMatch(/\.ui-company-picker-who,\s*\.ui-company-picker-caret \{\s*display: none;/)
        expect(phone).toMatch(/\.ui-company-picker \{\s*position: static;/)
        expect(phone).toMatch(/\.ui-company-picker-panel \{\s*inset-inline: var\(--space-2\);\s*inline-size: auto;/)
    })

    it("answers a tap at once, as the building blocks' other controls do", () => {
        const touch = css.slice(0, css.indexOf("touch-action: manipulation;"))
        expect(touch.slice(touch.lastIndexOf("}") + 1)).toContain(".ui-company-picker-button")
    })
})

describe("the top bar", () => {
    it("has the picker for the Super Admin alone, where the old switcher was", () => {
        expect(header).toContain("{currentUser.role === 'SUPER_ADMIN' && <CompanyPicker companies={companies} inViewId={selectedCompanyId || null} onPick={handleSelectCompany} />}")
    })

    it("no longer draws the old switcher, by hand or by measuring the window", () => {
        for (const old of ["glass sm-select", "isCompanyDropdownOpen", "getInitials", "isMobile", "window.innerWidth", "optionRefs", 'role="listbox"', "moveOption"]) expect(header, old).not.toContain(old)
    })
})

describe("its words", () => {
    it("are in both languages, in sentence case, and the Arabic asks nothing of a man or a woman", () => {
        expect([en.company_in_view, en.find_company, en.find_company_placeholder, en.no_company_matches, en.all_companies]).toEqual(["Company in view", "Find a company", "Name of a company…", "No company has that name", "All companies"])
        expect([ar.company_in_view, ar.find_company, ar.find_company_placeholder, ar.no_company_matches]).toEqual(["الشركة المعروضة", "البحث عن شركة", "اسم الشركة…", "لا توجد شركة بهذا الاسم"])
    })
})
