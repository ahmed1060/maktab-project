import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { CheckSquareIcon, GearSixIcon, HandshakeIcon, SquaresFourIcon, TrayIcon, TruckIcon } from "@phosphor-icons/react/ssr"
import { Icon } from "@/components/ui"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { modulesFrom } from "./modules"
import { COMPANY_GROUPS, SUPER_ADMIN_GROUPS, sideBarFor, type SideBarViewer } from "./side-bar"
import { ITEM_ICONS } from "./side-bar-icons"
import { permissionsOf } from "./useCan"
import { withGrants } from "./permissions/test-actors"
import { stripComments } from "./strip-comments"

/**
 * The side bar (DESIGN.md §5.1, §6), as the mock-up of the app's frame the
 * product owner approved on 2026-11-05 draws it: light, with Phosphor icons,
 * the company's mark and name at its top, Company settings and the rest
 * pinned at its foot over the legal links, and on a phone a drawer that is a
 * dialog while it's open and out of reach while it's closed.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const t = (key: string) => (en as Record<string, string>)[key] ?? key
const viewer = (role: string, flags: Partial<SideBarViewer> = {}): SideBarViewer => {
    const p = permissionsOf(withGrants({ id: "u1", role, companyId: role === "SUPER_ADMIN" ? null : "c1" }) as any)
    return { superAdmin: role === "SUPER_ADMIN", can: p.can, has: () => true, checkIn: false, companySettings: true, cashAdvances: false, ...flags }
}

type Props = {
    role?: string
    pathname?: string
    drawer?: boolean
    open?: boolean
    name?: string
    logoUrl?: string | null
    user?: { moduleLabels?: unknown; moduleIcons?: unknown }
    locale?: "en" | "ar"
}
async function sideBar({ role = "ADMIN", pathname = "/dashboard/tasks", drawer = false, open = false, name = "Nile Works", logoUrl = null, user, locale = "en" }: Props = {}) {
    state.locale = locale
    const { default: SideBar } = await import("@/components/SideBar")
    return renderToStaticMarkup(h(SideBar, {
        groups: sideBarFor(viewer(role)),
        modules: modulesFrom(user, locale === "ar" ? ((k: string) => (ar as Record<string, string>)[k] ?? k) as never : t as never),
        company: { name, logoUrl },
        pathname,
        drawer,
        open,
        onClose: () => {},
    }))
}

/** The whole link to `href`, from its tag to its end. */
function link(html: string, href: string): string {
    const at = html.search(new RegExp(`<a[^>]*href="${href.replace(/[/?]/g, "\\$&")}"`))
    expect(at, `no link to ${href}`).toBeGreaterThan(-1)
    return html.slice(at, html.indexOf("</a>", at) + 4)
}
const icon = (glyph: Parameters<typeof Icon>[0]["icon"], weight: "regular" | "fill" = "regular") =>
    renderToStaticMarkup(h(Icon, { icon: glyph, weight }))

describe("the side bar's items", () => {
    it("are links with their icon and name, in the groups lib/side-bar.ts gives", async () => {
        const html = await sideBar()
        expect(html).toContain(`<nav class="ui-side-nav" aria-label="${en.nav_main_menu}">`)
        const tasks = link(html, "/dashboard/tasks")
        expect(tasks).toContain('class="ui-side-item"')
        expect(tasks).toContain(`<span class="ui-side-label"><bdi>${en.tasks}</bdi></span>`)
        expect(link(html, "/dashboard/clients")).toContain(icon(HandshakeIcon))
        expect(link(html, "/dashboard/requests")).toContain(icon(TrayIcon))
        // Each group named, for screen readers once.
        expect(html).toContain(`<div role="group" aria-label="${en.nav_group_work}"><p class="ui-side-group-name" aria-hidden="true">${en.nav_group_work}</p>`)
    })

    it("say which is the page you're on, with the filled icon, and only that one", async () => {
        const html = await sideBar({ pathname: "/dashboard/tasks/t1" })
        const tasks = link(html, "/dashboard/tasks")
        expect(tasks).toContain('aria-current="page"')
        expect(tasks).toContain(icon(CheckSquareIcon, "fill"))
        // The dashboard only on its own page, not on every page under it.
        const dashboard = link(html, "/dashboard")
        expect(dashboard).not.toContain("aria-current")
        expect(dashboard).toContain(icon(SquaresFourIcon))
        expect(html.match(/aria-current="page"/g)).toHaveLength(1)
        expect(link(await sideBar({ pathname: "/dashboard" }), "/dashboard")).toContain(icon(SquaresFourIcon, "fill"))
    })

    it("show a company's own icon in place of the module's, drawn as the others are, and its own name", async () => {
        const user = { moduleLabels: { clients: "Vendors" }, moduleIcons: { clients: "truck" } }
        const clients = link(await sideBar({ user }), "/dashboard/clients")
        expect(clients).toContain(icon(TruckIcon))
        expect(clients).toContain("<bdi>Vendors</bdi>")
        expect(clients).not.toContain(icon(HandshakeIcon))
        // Filled on its page, as the module's own is (DESIGN.md §5.1).
        expect(link(await sideBar({ user, pathname: "/dashboard/clients" }), "/dashboard/clients")).toContain(icon(TruckIcon, "fill"))
    })

    it("show the module's own icon for one a company kept from before, an emoji", async () => {
        const clients = link(await sideBar({ user: { moduleIcons: { clients: "🏥" } } }), "/dashboard/clients")
        expect(clients).toContain(icon(HandshakeIcon))
        expect(clients).not.toContain("🏥")
    })

    it("have no emoji of the old side bar's", async () => {
        const html = await sideBar({ role: "SUPER_ADMIN" })
        for (const emoji of ["📊", "📲", "🕘", "⚙️", "🚀", "🧾", "🏢"]) expect(html, emoji).not.toContain(emoji)
    })

    it("draw every group of the Super Admin's too, each item with its own icon", async () => {
        const html = await sideBar({ role: "SUPER_ADMIN", pathname: "/dashboard/companies" })
        for (const group of SUPER_ADMIN_GROUPS) expect(html, group.key).toContain(`aria-label="${t(group.labelKey!)}"`)
        expect(link(html, "/dashboard/companies")).toContain('aria-current="page"')
    })
})

describe("the side bar's foot", () => {
    it("pins Company settings, Roles and access and Saved lists under the groups that scroll", async () => {
        const html = await sideBar()
        const groups = html.indexOf('<div class="ui-side-groups">')
        const pinned = html.indexOf('<div class="ui-side-pinned">')
        expect(groups).toBeGreaterThan(-1)
        expect(pinned).toBeGreaterThan(groups)
        const foot = html.slice(pinned)
        expect(link(foot, "/dashboard/settings")).toContain(icon(GearSixIcon))
        expect(foot).toContain('href="/dashboard/roles-and-access"')
        // Nothing of the groups above is down here.
        expect(foot).not.toContain('href="/dashboard/tasks"')
    })

    it("has the privacy policy and the terms of service under them", async () => {
        const html = await sideBar()
        const legal = html.indexOf('<p class="ui-side-legal">')
        expect(legal).toBeGreaterThan(html.indexOf('<div class="ui-side-pinned">'))
        expect(html.slice(legal)).toMatch(new RegExp(`^<p class="ui-side-legal"><a href="/privacy">${en.privacy_policy}</a><a href="/terms">${en.terms_of_service}</a></p>`))
    })

    it("names them in sentence case (DESIGN.md §3.4)", () => {
        expect(en.privacy_policy).toBe("Privacy policy")
        expect(en.terms_of_service).toBe("Terms of service")
    })
})

describe("the company's mark at its top", () => {
    it("is its logo on the light plate, beside its name", async () => {
        const html = await sideBar({ logoUrl: "https://files.test/logo.png" })
        expect(html).toMatch(/<div class="ui-side-head"><span class="ui-company-mark" aria-hidden="true"><img src="https:\/\/files.test\/logo.png" alt="" width="32" height="32" class="ui-logo-plate"\/><\/span><span class="ui-side-name"><bdi>Nile Works<\/bdi><\/span>/)
    })

    it("is the first letter of its name on the brand tile, without one, in whatever script it's written", async () => {
        expect(await sideBar()).toContain('<span class="ui-company-mark" aria-hidden="true"><span class="ui-company-letter">N</span></span>')
        expect(await sideBar({ name: "أعمال النيل", locale: "ar" })).toContain('<span class="ui-company-letter">أ</span>')
        expect(await sideBar({ name: "  delta sites" })).toContain('<span class="ui-company-letter">D</span>')
    })
})

describe("the side bar on a computer and on a phone", () => {
    it("is not a dialog on a computer", async () => {
        const html = await sideBar()
        expect(html).not.toContain('role="dialog"')
        expect(html).not.toContain("ui-side-scrim")
    })

    it("is out of reach on a phone while closed", async () => {
        const html = await sideBar({ drawer: true, open: false })
        expect(html).toMatch(/^<div class="ui-side-bar" data-open="false">/)
        expect(html).not.toContain('role="dialog"')
        expect(html).not.toContain("ui-side-scrim")
    })

    it("is a dialog over the dimmed page on a phone while open, named, with a button that closes it", async () => {
        const html = await sideBar({ drawer: true, open: true })
        expect(html).toMatch(new RegExp(`^<div class="ui-side-scrim" aria-hidden="true"></div><div class="ui-side-bar" data-open="true" role="dialog" data-dialog="[^"]+" aria-modal="true" aria-label="${en.nav_main_menu}" tabindex="-1">`))
        expect(html).toContain(`<button type="button" class="ui-side-close" aria-label="${en.close_menu}">`)
    })

    it("names the menu and its close button in Arabic too", async () => {
        const html = await sideBar({ drawer: true, open: true, locale: "ar" })
        expect(html).toContain(`aria-label="${ar.nav_main_menu}"`)
        expect(html).toContain(`aria-label="${ar.close_menu}"`)
        expect(html).toContain(`<p class="ui-side-legal"><a href="/privacy">${ar.privacy_policy}</a>`)
    })
})

describe("the side bar's look (components/ui/ui.css)", () => {
    const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
    const rule = (selector: string, from = css) => {
        const at = from.indexOf(`${selector} {`)
        expect(at, `no ${selector} rule`).toBeGreaterThan(-1)
        return from.slice(at, from.indexOf("}", at))
    }
    // From its first rule to the line that ends it, its comments taken out.
    const raw = readFileSync("components/ui/ui.css", "utf8")
    const block = stripComments(raw.slice(raw.indexOf(".ui-side-bar {"), raw.indexOf("/* end of the side bar */")))
    const phone = block.slice(block.indexOf("@media (max-width: 1023px)"))

    it("is light, 248px wide, beside the page and staying put as it scrolls", () => {
        const bar = rule(".ui-side-bar")
        expect(bar).toContain("inline-size: 248px;")
        expect(bar).toContain("position: sticky;")
        expect(bar).toContain("background: var(--panel);")
        expect(bar).toContain("border-inline-end: 1px solid var(--rule);")
    })

    it("draws its items 36px tall in --ink-2, the one you're on in --brand-text on --brand-tint", () => {
        const item = rule(".ui-side-item")
        expect(item).toContain("min-block-size: 36px;")
        expect(item).toContain("color: var(--ink-2);")
        expect(item).toContain("font-size: var(--text-md);")
        expect(item).toContain("border-radius: var(--radius-field);")
        expect(rule(".ui-side-item:hover")).toContain("background: var(--brand-tint);")
        const current = rule('.ui-side-item[aria-current="page"]')
        expect(current).toContain("background: var(--brand-tint);")
        expect(current).toContain("color: var(--brand-text);")
        expect(current).toContain("font-weight: 500;")
        // Inset, as a row's is: the groups scroll, and an outer ring would be cut off at their edge.
        expect(rule(".ui-side-item:focus-visible")).toMatch(/outline: 2px solid var\(--brand-text\);\s*outline-offset: -2px;/)
        const group = rule(".ui-side-group-name")
        expect(group).toContain("color: var(--muted);")
        expect(group).toContain("font-size: var(--text-sm);")
    })

    it("scrolls its groups and keeps the foot where it is", () => {
        expect(rule(".ui-side-groups")).toContain("overflow-y: auto;")
        expect(rule(".ui-side-pinned")).toContain("border-block-start: 1px solid var(--rule);")
    })

    it("is a drawer from the start side on a phone, decided by CSS so the first paint is right", () => {
        expect(phone).toContain("position: fixed;")
        expect(phone).toContain("inset-inline-start: 0;")
        expect(phone).toContain("inline-size: min(296px, calc(100vw - 48px));")
        // The window's height, its foot in view: aligned to the start, as it is
        // beside the page, a fixed box is only as tall as its content (found in
        // the browser: 955px on a 780px phone).
        expect(phone).toMatch(/\.ui-side-bar \{[^}]*inset-block: 0;[^}]*align-self: stretch;/)
        // Closed, it isn't drawn: neither Tab nor a screen reader goes through it.
        expect(phone).toMatch(/\.ui-side-bar \{[^}]*transform: translateX\(-100%\);[^}]*visibility: hidden;/)
        expect(phone).toMatch(/\[dir="rtl"\] \.ui-side-bar \{\s*transform: translateX\(100%\);\s*\}/)
        expect(phone).toMatch(/\.ui-side-bar\[data-open="true"\] \{[^}]*transform: none;[^}]*visibility: visible;/)
        // Open after the right to left rule, so it wins in Arabic too.
        expect(phone.indexOf('.ui-side-bar[data-open="true"] {')).toBeGreaterThan(phone.indexOf('[dir="rtl"] .ui-side-bar {'))
        expect(phone).toMatch(/\.ui-side-scrim \{[^}]*background: var\(--scrim\);/)
    })

    it("gives a phone's items, icons and links room for a finger (DESIGN.md §9)", () => {
        expect(phone).toMatch(/\.ui-side-item \{[^}]*min-block-size: 44px;[^}]*font-size: var\(--text-lg\);/)
        expect(phone).toMatch(/\.ui-side-item > \.ui-icon \{[^}]*inline-size: 20px;[^}]*block-size: 20px;/)
        expect(phone).toMatch(/\.ui-side-legal a \{[^}]*padding-block: var\(--space-3\);/)
        expect(phone).toMatch(/\.ui-side-close \{[^}]*inline-size: 44px;[^}]*block-size: 44px;/)
    })

    it("answers a tap at once, as the building blocks' other controls do (web interface audit)", () => {
        const touch = css.slice(0, css.indexOf("touch-action: manipulation;"))
        const list = touch.slice(touch.lastIndexOf("}") + 1)
        for (const selector of [".ui-side-item", ".ui-side-close", ".ui-side-legal a"]) expect(list, selector).toContain(selector)
    })

    it("slides in over 200ms and out over 150ms, and at once with reduce motion on (DESIGN.md §8)", () => {
        // As a phone's own sheets move (PR 224); lib/motion.test.ts has the rest of it.
        expect(phone).toContain("transition: transform 150ms var(--ease-drawer), visibility 0s linear 150ms;")
        expect(phone).toContain("transition: transform 200ms var(--ease-drawer);")
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-side-bar,\s*\.ui-side-bar\[data-open="true"\] \{\s*transition: none;/)
    })

    it("uses logical properties only (DESIGN.md §7)", () => {
        expect(block.length).toBeGreaterThan(500)
        expect(block).not.toMatch(/(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/m)
    })
})

describe("the icons", () => {
    it("are the ones DESIGN.md §6 names, for every item either side bar has", () => {
        const design = readFileSync("DESIGN.md", "utf8")
        const section = design.slice(design.indexOf("**The side bar's icons**"), design.indexOf("**A module's icon, chosen by its company**"))
        for (const key of [...COMPANY_GROUPS, ...SUPER_ADMIN_GROUPS].flatMap(g => g.items)) {
            const glyph = ITEM_ICONS[key]
            expect(glyph, key).toBeDefined()
            // Phosphor names each one for its icon, as CheckSquareIcon.
            const name = ((glyph as { displayName?: string }).displayName ?? "").replace(/Icon$/, "")
            expect(name, key).not.toBe("")
            expect(section, `${key}: ${name}`).toContain(`\`${name}\``)
        }
    })

    it("give every module a distinct one", () => {
        const modules = ["dashboard", "tasks", "obligations", "requests", "records", "costs", "employees", "clients", "locations"] as const
        expect(new Set(modules.map(k => ITEM_ICONS[k])).size).toBe(modules.length)
    })
})

describe("the shell", () => {
    const shell = stripComments(readFileSync("components/DashboardShell.tsx", "utf8"))
    const header = readFileSync("components/DashboardHeader.tsx", "utf8")

    it("draws the side bar, a drawer on a phone, and no other", () => {
        expect(shell).toMatch(/<SideBar\b[\s\S]*?drawer=\{isPhone\}[\s\S]*?open=\{drawerOpen\}/)
        for (const gone of ["isCollapsed", "glass-dark", "shell-aside", "🚀", "onMouseOver"]) expect(shell, gone).not.toContain(gone)
    })

    it("closes the drawer on another page, and when the window grows past a phone's", () => {
        // In the same render as the change, not in an effect after it (lib/useAdjustOnChange.ts).
        expect(shell).toContain("useAdjustOnChange([pathname, isPhone], () => setDrawerOpen(false))")
        expect(shell).toContain("window.matchMedia('(max-width: 1023px)')")
    })

    it("says on the menu button that it opens the menu as a dialog, and whether it's open", () => {
        expect(shell).toContain("menuOpen={drawerOpen}")
        expect(header).toMatch(/aria-haspopup="dialog"\s+aria-expanded=\{menuOpen\}/)
    })
})
