import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

/**
 * WCAG contrast for every foreground/background pair the palette declares, in
 * both themes.
 *
 * The plan asks for this explicitly, and it is the one part of a dark palette
 * that cannot be judged by looking: a pair can seem fine on the monitor it was
 * picked on and be unreadable on a dimmer one. 4.5:1 is the AA threshold for
 * body text; 3:1 is AA Large, which is what the solid accent colours are used
 * at (badges, chart strokes, icon fills) rather than as running text.
 */

const CSS = readFileSync("app/globals.css", "utf8")

function block(selector: string): Record<string, string> {
    const at = CSS.indexOf(selector)
    if (at === -1) throw new Error(`missing block: ${selector}`)
    const body = CSS.slice(at, CSS.indexOf("\n  }", at) === -1 ? CSS.indexOf("\n}", at) : CSS.indexOf("\n  }", at))
    const out: Record<string, string> = {}
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
        out[m[1]] = m[2]
    }
    return out
}

const LIGHT = block(":root {")
const DARK = block(':root[data-theme="dark"] {')

function toRgb(hex: string): [number, number, number] {
    const h = hex.replace("#", "")
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
    const [r, g, b] = toRgb(hex).map(v => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

/*
 * The status pairs went with the last things drawn in them: the indigo text
 * with a range's days in the old calendar (PR 208), the green, red and
 * orange pairs with the old components no page used (PR 222), and the amber
 * and blue ones with the old styles (PR 223). The building blocks' pairs are
 * held to AA 4.5:1 in lib/design-tokens.test.ts.
 */

/**
 * Body text against the surfaces it actually sits on. The body text colour,
 * the faint one and the sunk surface went with the old components (PR 222).
 */
const BODY_PAIRS: [string, string][] = [
    ["--text-strong", "--surface"],
    ["--text-main", "--surface"],
    ["--text-muted", "--surface"],
    ["--text-soft", "--surface"],
]

for (const [themeName, tokens] of [["light", LIGHT], ["dark", DARK]] as const) {
    describe(`${themeName}: body text meets AA 4.5:1 on its surfaces`, () => {
        for (const [fg, bg] of BODY_PAIRS) {
            it(`${fg} on ${bg}`, () => {
                const r = ratio(tokens[fg], tokens[bg])
                expect(r, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
            })
        }
    })
}

describe("the keyboard focus ring stands out (WCAG 1.4.11, 3:1)", () => {
    // It was the browser's own ring, hidden on every .input and on about ten
    // controls (accessibility audit, 4 October 2026, H3); now one ring in a
    // colour held to 3:1 against what it sits on, in each theme.
    for (const [themeName, tokens] of [["light", LIGHT], ["dark", DARK]] as const) {
        for (const bg of ["--surface", "--page-bg"]) {
            it(`${themeName}: --focus-ring on ${bg}`, () => {
                const r = ratio(tokens["--focus-ring"], tokens[bg])
                expect(r, `is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
            })
        }
    }

    it("has no ring of its own on the side bar, which is light now, as the page is", () => {
        // It was dark slate in both themes, with a light ring of its own that
        // followed the brand colour; the building blocks' ring is --brand-text,
        // held to the brand colour (lib/brand-colour.ts, DESIGN.md §5.1).
        expect(CSS).not.toContain(".glass-dark")
        expect(CSS).not.toContain("--sidebar-ring")
    })

    it("is shown for keyboard focus, and nothing turns it off", () => {
        expect(CSS).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--focus-ring\);/)
        // The only ring turned off is the page's own, which the skip link
        // reaches. The old fields', which hid it, went with them (PR 223).
        const ringsOff = [...stripComments(CSS).matchAll(/([^{}]*)\{[^}]*outline: none/g)].map(m => m[1].trim())
        expect(ringsOff).toEqual(["#main-content:focus"])
        const screens = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? screens(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
        const off = [...screens("app"), ...screens("components")].filter(f => /outline: *'none'/.test(readFileSync(f, "utf8")))
        expect(off).toEqual([])
    })
})

describe("text and controls the audit measured below AA (4 October 2026, H2)", () => {
    const screens = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? screens(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
    const SCREENS = [...screens("app"), ...screens("components")]

    // White on the old filled button (was 4.47 and 4.23:1) and the old
    // fields' outline (was 1.4:1) went with them (PR 223). The building
    // blocks' filled buttons are --on-brand on --brand, held to 4.5:1 with
    // the brand colour (lib/brand-colour.ts), and their fields' edge is
    // --field-line, 3:1 (lib/design-tokens.test.ts). The brand-coloured
    // link's token went with the old sign-in page, its last user (the
    // sign-in page's part 1); the building blocks' links are --brand-text.

    it("no text is coloured with a status colour's fill (-solid), only its text colour (-fg)", () => {
        // Red for errors, late dates and delete links, and green, amber and
        // blue status text, used the fill colours, 2.2 to 3.8:1 on white.
        const found = SCREENS.flatMap(f => [...readFileSync(f, "utf8").matchAll(/(?<![A-Za-z])color:[^,}\n]*var\(--(danger|ok|warn|info)-solid\)/g)].map(() => f))
        expect(found).toEqual([])
    })

    it("the side bar's group names and items read on its panel in both themes (were 1.2 to 3.7:1)", () => {
        const sideBar = readFileSync("components/SideBar.tsx", "utf8")
        expect(sideBar).not.toContain("var(--text-faint)")
        // One name, drawn for each of the side bar's groups (lib/side-bar.ts), in --muted (components/ui/ui.css).
        expect(sideBar.split('className="ui-side-group-name"').length - 1).toBe(1)
        const tokens = (selector: string) => {
            const at = CSS.indexOf(selector, CSS.indexOf("Design tokens (DESIGN.md)"))
            const body = CSS.slice(at, CSS.indexOf("\n}", at))
            return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map(m => [m[1], m[2]]))
        }
        for (const [name, theme] of [["light", tokens(":root {")], ["dark", tokens(':root[data-theme="dark"] {')]] as const) {
            for (const [fg, bg] of [["--muted", "--panel"], ["--ink-2", "--panel"], ["--ink-2", "--brand-tint"], ["--brand-text", "--brand-tint"]]) {
                const r = ratio(theme[fg], theme[bg])
                expect(r, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
            }
        }
    })
})

describe("the two themes are actually different", () => {
    it("inverts the surface scale rather than reusing it", () => {
        expect(luminance(DARK["--surface"])).toBeLessThan(luminance(LIGHT["--surface"]))
        expect(luminance(DARK["--text-main"])).toBeGreaterThan(luminance(LIGHT["--text-main"]))
    })

    it("defines a dark value for every light token that is a colour", () => {
        // A token with no dark value keeps its light one — a white card on a
        // dark page, which is the exact half-dark result the plan warns about.
        // Deliberately theme-invariant: the brand marks read correctly on both
        // grounds, and the bar along the top while a page changes keeps the
        // gradient it had as the old filled buttons', on which text stayed
        // white wherever the page ground went.
        //
        // --logo-plate is invariant for a different and stronger reason: a
        // customer's logo is drawn on it, in the side bar and wherever the
        // side bar is previewed, whatever its colours, so the plate behind it
        // must not follow the page ground. The side bar is dark in dark mode,
        // and a dark value would make every dark logo vanish into it, and
        // every white-background logo a white box on it, which is the failure
        // it exists to prevent.
        //
        // --paper and --ink-on-paper are invariant because they are not on a
        // screen at all. They exist for the print stylesheet, where the ground
        // is a sheet of paper and the ink is toner, and neither follows what
        // the reader has their display set to. A dark value would produce a
        // payslip printed white on black: unreadable, and expensive in a way
        // whoever pressed Print finds out about afterwards. The same goes for
        // --neutral-on-paper and the rest, a document's notes' bars on paper
        // (PR 155): dark mode's pale ones all but vanished on it.
        //
        // --map-* are invariant because they are drawn on map tiles, which
        // are light in both themes: a dark-mode ink would vanish into them.
        //
        // --cam-* are invariant because the face check's camera screen is
        // dark in both themes, as every camera's view is: the picture fills
        // it, and its guidance is light over it whatever the page around is.
        const INVARIANT = new Set([
            "--primary",
            "--logo-plate",
            "--paper", "--ink-on-paper",
            "--neutral-on-paper", "--waiting-on-paper", "--good-on-paper", "--problem-on-paper",
            "--button-from", "--button-to",
            "--map-pin", "--map-ink", "--map-halo", "--map-shadow",
            "--cam-ground", "--cam-ink", "--cam-done", "--cam-warn",
        ])

        const missing = Object.keys(LIGHT).filter(t => !(t in DARK) && !INVARIANT.has(t))
        expect(missing, `tokens with no dark value:\n${missing.join("\n")}`).toEqual([])
    })

    it("gives a document's notes' bars colours that show on paper (PR 155)", () => {
        // A bar is a part of the page somebody has to see, not text: 3:1.
        for (const bar of ["--neutral-on-paper", "--waiting-on-paper", "--good-on-paper", "--problem-on-paper"]) {
            const r = ratio(LIGHT[bar], LIGHT["--paper"])
            expect(r, `${bar} ${LIGHT[bar]} on paper is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
        }
    })
})

describe("dark: brand-coloured text meets AA 4.5:1 on its surfaces", () => {
    // Found by measuring every page's text in the dark theme. The brand indigo
    // (--primary, #6366f1) was used as text there unchanged, 2.8:1 on the dark
    // surfaces, and the audit log's action names (--accent-deepest, gone with
    // the old page in PR 175) 2.85:1. Text took --brand-primary-text, which
    // went with the old window's close button, its last user (PR 223); the
    // building blocks' brand text is --brand-text, held to 4.5:1 with the
    // brand colour (lib/brand-colour.ts).
    it("screens colour brand text with --brand-text, not with the button colour", () => {
        const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
        const offenders = [...files("app"), ...files("components")].filter(f =>
            /color: (?:[^,}]*\? )?'var\(--(?:brand-primary|primary)\)'/.test(readFileSync(f, "utf8")))
        expect(offenders).toEqual([])
    })
})

describe("white text on a status colour", () => {
    // Found by measuring every page's text in the dark theme: white on the
    // Approve button's green, the points badge's blue and an amber avatar was
    // 2.2 to 2.8:1, and much the same in the light theme. The -solid colours
    // are also text and strokes on the page, so the grounds under white text
    // were their own tokens, the same hues darkened.
    // The success fill went with the last thing on it, the Usernames page's
    // green download button (PR 182), the danger fill with a critical
    // notification's red edge in the bell's old panel (PR 207), and the
    // blue, orange and violet fills with the old filter panel (PR 222).
    it("screens put a fill, not a -solid colour, behind text", () => {
        const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
        const offenders = [...files("app"), ...files("components")].flatMap(f =>
            [...readFileSync(f, "utf8").matchAll(/background(?:Color)?: [^,\n]*?'var\(--((?:ok|info|warn|danger|accent)-solid[a-z-]*)\)'/g)]
                .map(m => `${f}: ${m[1]}`))
        expect(offenders).toEqual([])
    })
})
