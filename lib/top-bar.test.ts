import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * The top bar (DESIGN.md §5.1), as the mock-up of the app's frame the product
 * owner approved on 2026-11-05 draws it: no title, the language switch, the
 * bell with its count, and the account button with the account menu.
 */

const ui = { locale: "en" as "en" | "ar", theme: "light" as "light" | "dark" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key, setLanguage: () => {}, isChangingLocale: false }),
}))
vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: ui.theme, setTheme: () => {} }) }))
vi.mock("next/image", () => ({ default: (p: { src: string; alt: string; width: number; height: number }) => h("img", { src: p.src, alt: p.alt, width: p.width, height: p.height }) }))

const render = (el: ReturnType<typeof h>, locale: "en" | "ar" = "en") => { ui.locale = locale; return renderToStaticMarkup(el) }
const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
const rule = (selector: string, from = css) => {
    const at = from.indexOf(`${selector} {`)
    expect(at, `no ${selector} rule`).toBeGreaterThan(-1)
    return from.slice(at, from.indexOf("}", at))
}
const header = stripComments(readFileSync("components/DashboardHeader.tsx", "utf8"))
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

describe("the switch building block", () => {
    it("is a group, named, whose options say which is in use", async () => {
        const { Segmented } = await import("@/components/ui")
        const html = render(h(Segmented, { value: "b", label: "Pick one", onChange: () => {}, options: [{ value: "a", label: "First" }, { value: "b", label: "Second" }] }))
        expect(html).toContain('<div role="group" aria-label="Pick one" class="ui-segmented">')
        expect(html).toContain('<button type="button" class="ui-segmented-option" aria-pressed="false">First</button>')
        expect(html).toContain('<button type="button" class="ui-segmented-option" aria-pressed="true">Second</button>')
    })

    it("can be named by a visible label instead", async () => {
        const { Segmented } = await import("@/components/ui")
        const html = render(h(Segmented, { value: "a", labelledBy: "theme-label", onChange: () => {}, options: [{ value: "a", label: "A" }] }))
        expect(html).toContain('<div role="group" aria-labelledby="theme-label" class="ui-segmented">')
        expect(html).not.toContain("aria-label=")
    })

    it("is a pill with a --rule edge on --panel, the option in use in --brand-text on --brand-tint", () => {
        const box = rule(".ui-segmented")
        for (const part of ["display: inline-flex;", "border: 1px solid var(--rule);", "border-radius: var(--radius-pill);", "background: var(--panel);"]) expect(box, part).toContain(part)
        const option = rule(".ui-segmented-option")
        for (const part of ["min-block-size: 30px;", "border-radius: var(--radius-pill);", "color: var(--ink-2);", "font-size: var(--text-sm);"]) expect(option, part).toContain(part)
        const on = rule('.ui-segmented-option[aria-pressed="true"]')
        expect(on).toContain("background: var(--brand-tint);")
        expect(on).toContain("color: var(--brand-text);")
        expect(rule(".ui-segmented-option:focus-visible")).toContain("outline: 2px solid var(--brand-text);")
    })
})

describe("the language switch", () => {
    it("is both languages, each written in itself, named Language, the one in use marked", async () => {
        const { default: LanguageToggleButton } = await import("@/components/LanguageToggleButton")
        const html = render(h(LanguageToggleButton))
        expect(html).toContain('role="group" aria-label="Language"')
        expect(html).toMatch(/<button type="button" class="ui-segmented-option" aria-pressed="true" lang="en" aria-label="English"><span class="ui-segmented-long">English<\/span><span class="ui-segmented-short" aria-hidden="true">EN<\/span><\/button>/)
        expect(html).toMatch(/<button type="button" class="ui-segmented-option" aria-pressed="false" lang="ar" aria-label="العربية"><span class="ui-segmented-long">العربية<\/span><span class="ui-segmented-short" aria-hidden="true">ع<\/span><\/button>/)
    })

    it("keeps English first in Arabic: it's about language, not in one", async () => {
        const { default: LanguageToggleButton } = await import("@/components/LanguageToggleButton")
        const html = render(h(LanguageToggleButton), "ar")
        expect(html).toContain('role="group" aria-label="اللغة" class="ui-segmented" dir="ltr"')
        expect(html.indexOf('lang="en"')).toBeLessThan(html.indexOf('lang="ar"'))
        expect(html).toMatch(/aria-pressed="true" lang="ar"/)
    })

    it("says EN and ع on a phone's top bar alone, and its whole names everywhere else", () => {
        expect(rule(".ui-segmented-short")).toContain("display: none;")
        const phone = css.slice(css.indexOf("@media (max-width: 1023px)", css.indexOf(".ui-topbar {")))
        expect(phone).toMatch(/\.ui-topbar \.ui-segmented-long \{\s*display: none;/)
        expect(phone).toMatch(/\.ui-topbar \.ui-segmented-short \{\s*display: inline;/)
    })

    it("is named for what it is, not for the other language", () => {
        expect(en.language).toBe("Language")
        expect(ar.language).toBe("اللغة")
        expect("toggle_language" in en).toBe(false)
        expect("toggle_language" in ar).toBe(false)
    })
})

describe("the theme switch", () => {
    it("is Light and Dark with their icons, not emoji", async () => {
        const { default: ThemeToggleButton } = await import("@/components/ThemeToggleButton")
        const html = render(h(ThemeToggleButton))
        expect(html).toContain('role="group" aria-label="Theme"')
        expect(html).toMatch(/aria-pressed="true"><svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Light<\/button>/)
        expect(html).toMatch(/aria-pressed="false"><svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Dark<\/button>/)
        expect(html).not.toMatch(EMOJI)
    })

    it("in the account menu, is a row named by its visible label", async () => {
        const { default: ThemeToggleButton } = await import("@/components/ThemeToggleButton")
        const html = render(h(ThemeToggleButton, { variant: "menu-item" }), "ar")
        const id = html.match(/<span id="([^"]+)" class="ui-account-theme-label">المظهر<\/span>/)?.[1]
        expect(id).toBeTruthy()
        expect(html).toContain(`<div role="group" aria-labelledby="${id}" class="ui-segmented">`)
        expect(html).toContain('<div class="ui-account-theme">')
    })
})

describe("the account button", () => {
    const person = { id: "u1", name: "Salma Fathy", role: "Admin", companyName: "Nile Works", photo: null as string | null }
    const button = async (p = person, locale: "en" | "ar" = "en") => {
        const { AccountButton } = await import("@/components/DashboardHeader")
        return render(h(AccountButton, { person: p, open: false, menuId: "m1", onToggle: () => {} }), locale)
    }

    it("has the initials, the name, the role and a caret, and is named with all of them", async () => {
        const html = await button()
        expect(html).toContain('<button type="button" class="ui-topbar-account" aria-expanded="false" aria-label="Account menu, Salma Fathy, Admin">')
        expect(html).toContain('<span class="ui-avatar ui-avatar-32" aria-hidden="true">SF</span>')
        expect(html).toContain('<span class="ui-topbar-who"><span class="ui-topbar-name"><bdi>Salma Fathy</bdi></span><span class="ui-topbar-role">Admin</span></span>')
        expect(html).toMatch(/<svg[^>]*class="ui-icon ui-topbar-caret"/)
    })

    it("is named in Arabic with Arabic commas, a name with $ or braces kept as it is", async () => {
        expect(await button({ ...person, role: ar.role_admin }, "ar")).toContain(`aria-label="قائمة الحساب، Salma Fathy، ${ar.role_admin}"`)
        expect(await button({ ...person, name: "A$&B {role}" })).toContain('aria-label="Account menu, A$&amp;B {role}, Admin"')
        expect(en.account_menu_for).toBe("Account menu, {name}, {role}")
        expect(ar.account_menu_for).toBe("قائمة الحساب، {name}، {role}")
    })

    it("has the person's photo when they have one, and never a drawing for someone with none", async () => {
        expect(await button({ ...person, photo: "/uploads/salma.jpg" })).toContain('<span class="ui-avatar ui-avatar-32" aria-hidden="true"><img src="/uploads/salma.jpg" alt="" width="32" height="32"/></span>')
        expect(await button()).not.toMatch(EMOJI)
        expect(header).not.toContain("👩🏻")
        expect(header).not.toContain("👨🏻")
    })

    it("says the role as the app writes it, not in capitals", () => {
        expect(header).not.toContain("textTransform: 'uppercase'")
        expect(rule(".ui-topbar-role")).toContain("color: var(--ink-2);")
        expect(rule(".ui-topbar-name")).toContain("color: var(--ink);")
    })

    it("is its photo or initials alone on a phone, and is 44px tall", () => {
        const phone = css.slice(css.indexOf("@media (max-width: 1023px)", css.indexOf(".ui-topbar {")))
        expect(phone).toMatch(/\.ui-topbar-who,\s*\.ui-topbar-caret \{\s*display: none;/)
        expect(rule(".ui-topbar-account")).toContain("min-block-size: 44px;")
    })
})

describe("the account menu", () => {
    const person = { id: "u1", name: "Salma Fathy", role: "Admin", companyName: "Nile Works", photo: null as string | null }
    const panel = async (props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") => {
        const { AccountMenuPanel } = await import("@/components/DashboardHeader")
        return render(h(AccountMenuPanel, { id: "m1", person, showHistory: false, onClose: () => {}, onSignOut: () => {}, signingOut: false, ...props }), locale)
    }

    it("has the person at its top: their initials, their name, and their role at their company", async () => {
        const html = await panel()
        expect(html).toContain('<div id="m1" class="ui-account-menu">')
        expect(html).toContain('<div class="ui-account-head"><span class="ui-avatar ui-avatar-40" aria-hidden="true">SF</span><span class="ui-account-who"><span class="ui-account-name"><bdi>Salma Fathy</bdi></span><span class="ui-account-role">Admin at <bdi>Nile Works</bdi></span></span></div>')
        expect(await panel({ person: { ...person, role: ar.role_admin } }, "ar")).toContain('<span class="ui-account-role">مسؤول في <bdi>Nile Works</bdi></span>')
    })

    it("says the Super Admin's role alone, as they belong to no one company", async () => {
        const html = await panel({ person: { ...person, name: "Sara Hassan", role: "Super Admin", companyName: null } })
        expect(html).toContain('<span class="ui-account-role">Super Admin</span>')
    })

    it("has My profile, Security settings, the theme and Sign out, each with its icon, between hairlines", async () => {
        const html = await panel()
        expect(html).toMatch(/<a class="ui-menu-item" href="\/dashboard\/employees\/u1"><svg[^>]*>[\s\S]*?<\/svg>My profile<\/a>/)
        expect(html).toMatch(/<a class="ui-menu-item" href="\/dashboard\/security-settings"><svg[^>]*>[\s\S]*?<\/svg>Security settings<\/a>/)
        expect(html).toContain('<div class="ui-account-theme">')
        expect(html).toMatch(/<button type="button" class="ui-menu-item"[^>]*><svg[^>]*>[\s\S]*?<\/svg>Sign out<\/button>/)
        expect(html.match(/<div class="ui-menu-rule"><\/div>/g)).toHaveLength(3)
        expect(html).not.toContain("/history")
        expect(html).not.toContain("ui-menu-item-danger")
    })

    it("has History where it's offered", async () => {
        expect(await panel({ showHistory: true })).toMatch(/<a class="ui-menu-item" href="\/dashboard\/employees\/u1\/history"><svg[^>]*>[\s\S]*?<\/svg>History<\/a>/)
    })

    it("offers History where the package includes Payroll, for anyone but an Admin or the Super Admin, as before", () => {
        expect(header).toContain("const showHistory = features.has('PAYROLL') && !['ADMIN', 'SUPER_ADMIN'].includes(currentUser.role)")
    })

    it("says Sign out, while signing out too", async () => {
        expect(en.sign_out).toBe("Sign out")
        expect(await panel({ signingOut: true })).toMatch(/<button type="button" class="ui-menu-item" disabled="" aria-busy="true">/)
    })

    it("is 300px wide within the screen, on --panel-raised, with the menu's corners and shadow", () => {
        const menu = rule(".ui-account-menu")
        for (const part of ["inline-size: 300px;", "max-inline-size: calc(100vw - 32px);", "background: var(--panel-raised);", "border: 1px solid var(--rule);", "border-radius: var(--radius-menu);", "box-shadow: var(--elev-2);", "inset-inline-end: 0;"]) expect(menu, part).toContain(part)
        expect(rule(".ui-account-menu .ui-menu-item")).toContain("min-block-size: 40px;")
    })

    it("wraps a long name or company, a word with no spaces in it too, rather than running out of it", () => {
        const who = rule(".ui-account-who")
        expect(who).toContain("min-inline-size: 0;")
        expect(who).toContain("overflow-wrap: anywhere;")
    })

    it("closes on Escape, giving focus back to the button, on a click outside it, and on Tab past its last control", () => {
        expect(header).toContain("if (e.key === 'Escape') { setIsMenuOpen(false); accountRef.current?.focus() }")
        expect(header).toMatch(/document\.addEventListener\('pointerdown', outside\)/)
        // Not when focus goes nowhere: Safari doesn't focus a button on a click,
        // and a click outside is the pointerdown's.
        expect(header).toContain("if (e.relatedTarget && !accountBox.current?.contains(e.relatedTarget as Node)) setIsMenuOpen(false)")
    })
})

describe("the bell", () => {
    const bell = stripComments(readFileSync("components/NotificationBell.tsx", "utf8"))
    const opener = bell.slice(bell.indexOf("<button"), bell.indexOf("</button>") + 9)

    it("is a round icon button, named with how many are unread", () => {
        expect(opener).toContain('className="ui-topbar-button"')
        expect(opener).toContain("<Icon icon={BellIcon} className=\"ui-topbar-icon\" />")
        expect(opener).toContain("aria-label={unreadCount > 0 ? `${t('notifications')}${t('top_bar_unread').replace('{count}', num(unreadCount))}` : t('notifications')}")
        expect(en.top_bar_unread).toBe(", {count} unread")
        expect(ar.top_bar_unread).toBe("، غير المقروءة: {count}")
    })

    it("has its count in a --brand pill, in the page's digits, hidden from screen readers, and no emoji", () => {
        expect(opener).toContain('{unreadCount > 0 && <span className="ui-topbar-count" aria-hidden="true">{num(unreadCount)}</span>}')
        expect(opener).not.toMatch(EMOJI)
        expect(opener).not.toContain("--danger-fill")
        const count = rule(".ui-topbar-count")
        for (const part of ["position: absolute;", "inset-inline-end: 4px;", "min-inline-size: 18px;", "block-size: 18px;", "border-radius: var(--radius-pill);", "background: var(--brand);", "color: var(--on-brand);", "font-size: var(--text-xs);", "font-variant-numeric: tabular-nums;"]) expect(count, part).toContain(part)
    })
})

describe("the bar", () => {
    it("has no title: every page names itself in its page header", () => {
        expect(header).not.toContain("ui-topbar-title")
        expect(header).not.toMatch(/<h1\b/)
        expect(header).not.toContain("useHeader")
        expect(css).not.toContain(".ui-topbar-title")
    })

    it("and what pages set its title with is gone, with nothing left to read it", () => {
        expect(existsSync("context/HeaderContext.tsx")).toBe(false)
        expect(readFileSync("app/providers.tsx", "utf8")).not.toContain("HeaderProvider")
        expect(readFileSync("app/(dashboard)/dashboard/ui-kit/page.tsx", "utf8")).not.toMatch(/useHeader|setTitle\(/)
    })

    // Codex review on PR 205: it opened from its end edge, as when the
    // switcher was at the bar's end, so on a phone it ran off the screen's
    // start, 72px in English and 79px in Arabic.
    it("opens the Super Admin's company list from the switcher's start edge, into the screen", () => {
        const list = header.slice(header.indexOf('role="listbox"'), header.indexOf("{switcherOptions.map("))
        expect(list).toContain("insetInlineStart: 0,")
        expect(list).not.toMatch(/\[locale === 'ar' \? 'left' : 'right'\]|\b(left|right): 0/)
    })

    it("has the Super Admin's company switcher at its start, then the language switch, the bell and the account button", () => {
        const markup = header.slice(header.indexOf("return (", header.indexOf("export default function DashboardHeader")))
        const at = (s: string) => { const i = markup.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i }
        expect(at("aria-haspopup=\"listbox\"")).toBeLessThan(at('<span className="ui-topbar-spacer" />'))
        expect(at('<span className="ui-topbar-spacer" />')).toBeLessThan(at("<LanguageToggleButton />"))
        expect(at("<LanguageToggleButton />")).toBeLessThan(at("<NotificationBell"))
        expect(at("<NotificationBell")).toBeLessThan(at("<AccountButton"))
    })

    it("has the menu button and the company's mark at its start on a phone", () => {
        expect(header).toContain('<button type="button" className="ui-topbar-button ui-topbar-menu" aria-label={t(\'open_menu\')} aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMenuClick}>')
        expect(header).toContain('<span className="ui-topbar-mark"><CompanyMark name={company.name} logoUrl={company.logoUrl} /></span>')
        expect(rule(".ui-topbar-menu,\n.ui-topbar-mark")).toContain("display: none;")
    })

    it("is 60px tall, 56px on a phone, with 44px round buttons and --ink-2 icons", () => {
        const bar = rule(".ui-topbar")
        for (const part of ["block-size: 60px;", "display: flex;", "align-items: center;", "padding-inline: var(--space-8);"]) expect(bar, part).toContain(part)
        const button = rule(".ui-topbar-button")
        for (const part of ["inline-size: 44px;", "block-size: 44px;", "border-radius: var(--radius-pill);", "color: var(--ink-2);"]) expect(button, part).toContain(part)
        expect(rule('.ui-topbar-button:hover,\n.ui-topbar-account:hover,\n.ui-topbar-account[aria-expanded="true"]')).toContain("background: var(--brand-tint);")
        expect(rule(".ui-topbar-icon")).toContain("inline-size: 20px;")
        const phone = css.slice(css.indexOf("@media (max-width: 1023px)", css.indexOf(".ui-topbar {")))
        expect(phone).toMatch(/\.ui-topbar-frame,\s*\.ui-topbar \{\s*block-size: 56px;/)
        expect(phone).toMatch(/\.ui-topbar-icon \{\s*inline-size: 22px;\s*block-size: 22px;/)
    })

    it("floats as glass once the page scrolls, drawn on a layer inside it, so the page never moves", () => {
        const frame = rule(".ui-topbar-frame")
        for (const part of ["position: sticky;", "inset-block-start: 0;", "block-size: 60px;"]) expect(frame, part).toContain(part)
        expect(frame).not.toContain("margin")
        expect(rule(".ui-topbar")).toContain("position: absolute;")
        const floating = rule('.ui-topbar-frame[data-floating="true"] .ui-topbar')
        for (const part of ["inset-block-start: var(--space-4);", "inset-inline: var(--space-4);", "padding-inline: var(--space-4);", "border-radius: 24px;", "background: var(--header-glass-bg);", "backdrop-filter: blur(20px) saturate(160%);", "-webkit-backdrop-filter: blur(20px) saturate(160%);", "border-color: var(--header-glass-border);", "box-shadow: var(--header-shadow);"]) expect(floating, part).toContain(part)
        const shell = stripComments(readFileSync("components/DashboardShell.tsx", "utf8"))
        expect(shell).toContain('<div className="ui-topbar-frame" data-floating={isScrolled ? \'true\' : \'false\'}>')
        expect(shell).not.toMatch(/margin(Top)?: isScrolled/)
    })

    it("keeps what's in it where it was as it floats: its inset and padding add up to the padding it had", () => {
        const px = (v: string) => ({ "0": 0, "var(--space-2)": 8, "var(--space-4)": 16, "var(--space-8)": 32 } as Record<string, number>)[v.trim()]
        const value = (body: string, prop: string) => body.match(new RegExp(`(?:^|[\\s;])${prop}: ([^;]+);`))?.[1] ?? ""
        const phone = css.slice(css.indexOf("@media (max-width: 1023px)", css.indexOf(".ui-topbar-frame {")), css.indexOf("/* end of the top bar */"))
        // Every block for the selector in the phone's rules, as one.
        const inPhone = (selector: string) => [...phone.matchAll(new RegExp(`\\n  ${selector.replace(/[.[\]="()-]/g, "\\$&")} \\{([^}]*)\\}`, "g"))].map(m => m[1]).join("")
        const floating = '.ui-topbar-frame[data-floating="true"] .ui-topbar'
        // A computer: 32px at the top, 16px in and 16px of padding floating.
        expect(px(value(rule(".ui-topbar"), "padding-inline"))).toBe(32)
        expect(px(value(rule(floating), "inset-inline")) + px(value(rule(floating), "padding-inline"))).toBe(32)
        // A phone: 8px at the top, 8px in and none floating (DESIGN.md §5.1).
        expect(px(value(inPhone(".ui-topbar"), "padding-inline"))).toBe(8)
        expect([px(value(inPhone(floating), "inset-inline")), px(value(inPhone(floating), "padding-inline"))]).toEqual([8, 0])
        expect(readFileSync("DESIGN.md", "utf8")).toContain("(8px on a phone, where its buttons are\n    already 8px from the screen's edges")
    })

    it("eases into it over 300ms, changing only what it must, and at once with reduce motion on", () => {
        const bar = rule(".ui-topbar")
        expect(bar).toMatch(/transition: background-color 300ms ease-out, backdrop-filter 300ms ease-out, -webkit-backdrop-filter 300ms ease-out, border-color 300ms ease-out, box-shadow 300ms ease-out, inset 300ms ease-out, border-radius 300ms ease-out, padding 300ms ease-out;/)
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-topbar \{\s*transition: none;/)
    })

    it("answers a tap at once, as the building blocks' other controls do", () => {
        const touch = css.slice(0, css.indexOf("touch-action: manipulation;"))
        const list = touch.slice(touch.lastIndexOf("}") + 1)
        for (const selector of [".ui-topbar-button", ".ui-topbar-account", ".ui-segmented-option"]) expect(list, selector).toContain(selector)
    })

    it("floats on solid --panel where the browser can't blur", () => {
        expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\s*\.ui-topbar-frame\[data-floating="true"\] \.ui-topbar \{\s*background: var\(--panel\);/)
    })

    it("keeps the skip link's target clear of it, floating", () => {
        const globals = readFileSync("app/globals.css", "utf8")
        expect(globals).toMatch(/#main-content \{\s*scroll-margin-top: calc\(60px \+ 16px\);/)
    })
})
