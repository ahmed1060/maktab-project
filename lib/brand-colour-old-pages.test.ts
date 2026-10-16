import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { BRAND_PRESETS, DEFAULT_BRAND, OLD_PAGE_SHADES, brandStyleSheet, contrast, oldPageShades } from "./brand-colour"
import { stripComments } from "./strip-comments"

/**
 * The older pages, the side bar and the sign-in page follow the brand
 * colour (DESIGN.md §2.1, UI_PLAN.md §4.6): their indigo and violet shades
 * keep their distance from Nizmo's indigo, measured from the chosen colour,
 * and keep the readability they have today.
 */

const globals = readFileSync("app/globals.css", "utf8")
const lightRoot = globals.slice(globals.indexOf(":root {"), globals.indexOf(':root[data-theme="dark"] {'))
const darkStart = globals.indexOf(':root[data-theme="dark"] {')
const darkRoot = globals.slice(darkStart, globals.indexOf("\n}", darkStart))
const valueIn = (block: string, token: string) => block.match(new RegExp(`^\\s*${token}:\\s*(#[0-9a-f]{6});`, "m"))?.[1]

// The colours somebody might pick: the ready-made ones, and the awkward
// ones (too light for white text, near white, black, grey, a pale tint).
const COLOURS = [...BRAND_PRESETS.map(p => p.hex), "#facc15", "#fef08a", "#ffffff", "#000000", "#808080", "#e0e7ff", "#ff00ff"]

// What the shades sit on, from app/globals.css.
const LIGHT_GROUNDS = ["--surface", "--surface-subtle", "--surface-sunk"].map(t => valueIn(lightRoot, t)!)
const DARK_GROUNDS = ["--surface", "--surface-subtle", "--surface-sunk", "--page-bg"].map(t => valueIn(darkRoot, t)!)
function over(top: number[], alpha: number, under: string) {
    const u = [1, 3, 5].map(i => parseInt(under.slice(i, i + 2), 16))
    return "#" + u.map((v, i) => Math.round(top[i] * alpha + v * (1 - alpha)).toString(16).padStart(2, "0")).join("")
}
const sidebar = (block: string, page: string) => {
    const [r, g, b, a] = block.match(/--sidebar-bg:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!.slice(1).map(Number)
    return over([r, g, b], a, page)
}

/** Colourfulness and hue as the eye sees them (OKLCH): indigo to violet is 255° to 330°. */
function oklch(value: string) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * q
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * q
    return { c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 }
}

type Shade = (typeof OLD_PAGE_SHADES)[number]
function grounds(shade: Shade, theme: "light" | "dark", page: string): string[] {
    const behind = "behind" in shade ? shade.behind : undefined
    if (behind === "map") return ["#ffffff"]
    if (behind === "sidebar") return [theme === "light" ? sidebar(lightRoot, page) : sidebar(darkRoot, valueIn(darkRoot, "--page-bg")!)]
    return theme === "light" ? [...LIGHT_GROUNDS, page] : DARK_GROUNDS
}
function readability(c: string, shade: Shade, theme: "light" | "dark", page: string) {
    if (shade.role === "fill") return contrast("#ffffff", c)
    return Math.min(...grounds(shade, theme, page).map(g => contrast(c, g)))
}
const AIM = { fill: 4.5, text: 4.5, edge: 3, ground: 0, decor: 0 } as const

describe("the older pages' shades", () => {
    it("are exactly today's with Nizmo's indigo, in both themes", () => {
        const today = oldPageShades(DEFAULT_BRAND)
        for (const shade of OLD_PAGE_SHADES) {
            expect(valueIn(lightRoot, shade.token), shade.token).toBe(shade.light)
            expect(today.light[shade.token], shade.token).toBe(shade.light)
            if ("dark" in shade) {
                expect(valueIn(darkRoot, shade.token), `${shade.token} dark`).toBe(shade.dark)
                expect(today.dark[shade.token], `${shade.token} dark`).toBe(shade.dark)
            } else if (!("lightOnly" in shade)) {
                // The same in both themes: dark mode doesn't set its own.
                expect(valueIn(darkRoot, shade.token), `${shade.token} dark`).toBeUndefined()
            }
        }
    })

    it("cover every indigo and violet in app/globals.css, except the colours that mean something", () => {
        // The info colours, and the lifetime and role badges' violets, keep
        // their meaning in every company, like the status colours.
        const stays = /^--(info-|lifetime-|accent-fg$)/
        const following = new Set<string>(OLD_PAGE_SHADES.map(s => s.token))
        for (const block of [lightRoot, darkRoot]) {
            for (const [, token, value] of block.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-f]{6});/gm)) {
                if (stays.test(token) || following.has(token)) continue
                const { c, h } = oklch(value)
                const violetish = c > 0.04 && h >= 255 && h <= 330
                expect(violetish, `${token} ${value} is indigo or violet but doesn't follow the brand`).toBe(false)
            }
        }
        expect(globals).not.toMatch(/rgba\(99, ?102, ?241/)
    })

    it("read as well as they do with Nizmo's indigo, up to WCAG's aim, whatever the colour", () => {
        const defaultPage = OLD_PAGE_SHADES.find(s => s.token === "--page-bg")!.light
        for (const picked of COLOURS) {
            const shades = oldPageShades(picked)
            const page = shades.light["--page-bg"]
            for (const shade of OLD_PAGE_SHADES) {
                const themes: ["light" | "dark", string, string | undefined][] = [["light", shade.light, shades.light[shade.token]]]
                if ("dark" in shade) themes.push(["dark", shade.dark, shades.dark[shade.token]])
                for (const [theme, today, now] of themes) {
                    expect(now, `${picked} ${shade.token} ${theme}`).toMatch(/^#[0-9a-f]{6}$/)
                    const need = Math.min(AIM[shade.role], readability(today, shade, theme, defaultPage))
                    expect(readability(now!, shade, theme, page), `${picked} ${shade.token} ${theme}`).toBeGreaterThanOrEqual(need - 0.005)
                }
            }
        }
    })

    it("take the chosen colour's hue: the brand stands in for Nizmo's indigo", () => {
        // Blue reads white text at 5.2:1, so it's used as it is.
        expect(oldPageShades("#2563eb").light["--primary"]).toBe("#2563eb")
        // A green page is green, not indigo: more green than blue in every fill.
        const green = oldPageShades("#16a34a").light
        for (const token of ["--primary", "--button-from", "--hero-from", "--link"] as const) {
            const [, g, b] = [1, 3, 5].map(i => parseInt(green[token].slice(i, i + 2), 16))
            expect(g, token).toBeGreaterThan(b)
        }
        // A grey gives greys.
        const grey = oldPageShades("#808080").light
        for (const value of Object.values(grey)) {
            const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
            expect(Math.max(r, g, b) - Math.min(r, g, b), value).toBeLessThanOrEqual(2)
        }
    })

    it("are in the brand stylesheet, for each theme", () => {
        const sheet = brandStyleSheet("#16a34a")
        const [light, dark] = sheet.split('html:root[data-theme="dark"]')
        const shades = oldPageShades("#16a34a")
        expect(light).toContain(`--button-from:${shades.light["--button-from"]}`)
        expect(light).toContain(`--page-bg:${shades.light["--page-bg"]}`)
        expect(dark).toContain(`--link:${shades.dark["--link"]}`)
        // The page's ground is pale in light mode only; dark mode keeps its own.
        expect(dark).not.toContain("--page-bg")
    })
})

describe("the side bar and the glows go through them", () => {
    it("draws the side bar's ring and the company name's gradient from the shades", () => {
        expect(stripComments(globals)).toMatch(/\.glass-dark \{\s*--focus-ring: var\(--sidebar-ring\);/)
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        expect(shell).toContain("linear-gradient(to right, var(--surface), var(--sidebar-accent))")
        expect(shell).not.toContain("--info-border-indigo")
    })

    it("draws the indigo glows from --primary rather than a fixed indigo", () => {
        const css = stripComments(globals)
        for (const glow of [
            "--page-veil-a: color-mix(in srgb, var(--primary) 15%, transparent);",
            "--page-veil-a: color-mix(in srgb, var(--primary) 10%, transparent);",
            "box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 15%, transparent);",
            "box-shadow: 0 4px 15px color-mix(in srgb, var(--primary) 35%, transparent);",
        ]) expect(css).toContain(glow)
    })
})
