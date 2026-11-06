import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Two header menus in the dark theme. Read notifications sat on a hard-coded
 * white, under text the dark theme makes light, so they could barely be read.
 * And the profile menu was a fixed 200px, narrower than the Light / Dark
 * switch, which scrolled sideways inside it.
 */
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])

describe("notifications in the dark theme", () => {
    it("put read notifications on the theme's panel, not white", () => {
        // The bell's panel draws itself with the building blocks' CSS since PR 207.
        const bell = readFileSync("components/NotificationBell.tsx", "utf8")
        expect(bell).not.toContain("style={{")
        expect(bell).not.toMatch(/'white'|'black'/)
        const css = readFileSync("components/ui/ui.css", "utf8")
        const panel = css.slice(css.indexOf("\n.ui-notices {"), css.indexOf("}", css.indexOf("\n.ui-notices {")))
        expect(panel).toContain("background: var(--panel-raised);")
    })

    it("and nothing paints a background in a named colour the theme can't change", () => {
        // The token test catches hex; a colour name slipped past it.
        const bad = [...files("app"), ...files("components")].flatMap(f =>
            readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l] as const)
                .filter(([, , l]) => /background(Color)?:\s*['"`](white|black)['"`]|\?\s*'white'\s*:\s*'var\(--/.test(l))
                .map(([f, n, l]) => `${f}:${n}: ${l.trim()}`))
        expect(bad).toEqual([])
    })
})

describe("the profile menu", () => {
    // Its width is set in the building blocks' CSS since the top bar moved
    // onto them (PR 205): as wide as the mock-up draws it, within the screen.
    it("is as wide as its widest row, within the screen", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        const menu = css.match(/\n\.ui-account-menu \{([^}]*)\}/)?.[1] ?? ""
        expect(menu).toContain("inline-size: 300px;")
        expect(menu).toContain("max-inline-size: calc(100vw - 32px);")
    })
})

describe("the account menu's opener", () => {
    const header = readFileSync("components/DashboardHeader.tsx", "utf8")
    const opener = header.slice(header.indexOf("export function AccountButton"), header.indexOf("export function AccountMenuPanel"))

    it("is a button the keyboard can reach, saying whether its panel is open", () => {
        expect(opener).toMatch(/<button type="button" ref=\{buttonRef\}/)
        expect(opener).toContain("aria-expanded={open}")
        expect(opener).toContain("aria-controls={open ? menuId : undefined}")
        expect(header).toContain('<div id={id} className="ui-account-menu">')
        expect(header).toMatch(/<AccountButton person=\{person\} open=\{isMenuOpen\} menuId=\{accountMenuId\}/)
        expect(header).not.toMatch(/<div\s+onClick=\{\(\) => setIsMenuOpen\(!isMenuOpen\)\}/)
    })

    // Codex review on #41: the panel holds links, buttons and switches, not
    // menu items, so it is a disclosure; "menu" promised a menu it isn't.
    it("doesn't claim to open an ARIA menu", () => {
        expect(opener).not.toContain('aria-haspopup="menu"')
        expect(header).not.toContain('role="menu"')
    })

    // Codex review on #41: Escape was heard only inside the panel, but right
    // after Enter opens it, focus is still on the button.
    it("closes on Escape from the button or the panel, and goes back to the button", () => {
        const wrapper = header.slice(header.indexOf('<div ref={accountBox} className="ui-account"'), header.indexOf("<AccountButton person="))
        expect(wrapper).toMatch(/onKeyDown=\{e => \{ if \(e\.key === 'Escape'\) \{ setIsMenuOpen\(false\); accountRef\.current\?\.focus\(\) \} \}\}/)
    })
})
