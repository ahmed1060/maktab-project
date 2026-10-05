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

