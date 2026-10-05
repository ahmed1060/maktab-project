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
    it("put read notifications on the theme's surface, not white", () => {
        const bell = readFileSync("components/NotificationBell.tsx", "utf8")
        expect(bell).toContain("n.read ? 'var(--surface)'")
        expect(bell).not.toMatch(/'white'|'black'/)
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
    it("is as wide as its widest row, within the screen", () => {
        const header = readFileSync("components/DashboardHeader.tsx", "utf8")
        const menu = header.slice(header.indexOf("top: '120%'"), header.indexOf("zIndex: 100,", header.indexOf("top: '120%'")))
        expect(menu).toContain("width: 'max-content'")
        expect(menu).toContain("minWidth: 'min(200px, calc(100vw - 3rem))'")
        expect(menu).toContain("maxWidth: 'calc(100vw - 3rem)'")
    })
})

describe("the account menu's opener", () => {
    const header = readFileSync("components/DashboardHeader.tsx", "utf8")
    const opener = header.slice(header.indexOf("ref={accountRef}") - 120, header.indexOf("aria-label={t('account_menu'") + 60)

    it("is a button the keyboard can reach, saying whether its panel is open", () => {
        expect(opener).toContain('<button\n                            type="button"')
        expect(opener).toContain("aria-expanded={isMenuOpen}")
        expect(opener).toContain("aria-controls={isMenuOpen ? accountMenuId : undefined}")
        expect(header).toContain("<div id={accountMenuId}")
        expect(header).not.toMatch(/<div\s+onClick=\{\(\) => setIsMenuOpen\(!isMenuOpen\)\}/)
    })

    // Codex review on #41: the panel holds links, buttons and switches, not
    // menu items, so it is a disclosure; "menu" promised a menu it isn't.
    it("doesn't claim to open an ARIA menu", () => {
        expect(opener).not.toContain('aria-haspopup="menu"')
    })

    // Codex review on #41: Escape was heard only inside the panel, but right
    // after Enter opens it, focus is still on the button.
    it("closes on Escape from the button or the panel, and goes back to the button", () => {
        const wrapper = header.slice(header.indexOf("Avatar Container with Dropdown"), header.indexOf("ref={accountRef}"))
        expect(wrapper).toMatch(/onKeyDown=\{e => \{\s*if \(e\.key === 'Escape' && isMenuOpen\) \{ setIsMenuOpen\(false\); accountRef\.current\?\.focus\(\) \}/)
    })
})
