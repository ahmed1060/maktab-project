import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

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

/** Text pairs, held to AA 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
    ["--ok-fg", "--ok-bg"],
    // The real pairing: --ok-bg-strong is the far stop of the login success
    // gradient and a ring colour, never a ground under --ok-fg-strong.
    ["--ok-fg", "--ok-bg-strong"],
    ["--danger-fg", "--danger-bg"],
    ["--danger-fg-strong", "--danger-bg"],
    ["--warn-fg", "--warn-bg"],
    ["--warn-fg-warm", "--warn-bg-warm"],
    ["--warn-fg-yellow", "--warn-bg-yellow"],
    ["--info-fg", "--info-bg"],
    ["--info-fg-deep", "--info-bg-sky"],
    ["--info-fg-indigo", "--info-bg-indigo"],
]

/** Body text against the surfaces it actually sits on. */
const BODY_PAIRS: [string, string][] = [
    ["--text-strong", "--surface"],
    ["--text-main", "--surface"],
    ["--text-body", "--surface"],
    ["--text-muted", "--surface"],
    ["--text-soft", "--surface"],
    ["--text-body", "--surface-sunk"],
    ["--text-muted", "--surface-sunk"],
]

for (const [themeName, tokens] of [["light", LIGHT], ["dark", DARK]] as const) {
    describe(`${themeName}: status pairs meet AA 4.5:1`, () => {
        for (const [fg, bg] of TEXT_PAIRS) {
            it(`${fg} on ${bg}`, () => {
                const f = tokens[fg], b = tokens[bg]
                expect(f, `${fg} undefined in ${themeName}`).toBeDefined()
                expect(b, `${bg} undefined in ${themeName}`).toBeDefined()
                const r = ratio(f, b)
                expect(r, `${fg} ${f} on ${bg} ${b} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
            })
        }
    })

    describe(`${themeName}: body text meets AA 4.5:1 on its surfaces`, () => {
        for (const [fg, bg] of BODY_PAIRS) {
            it(`${fg} on ${bg}`, () => {
                const r = ratio(tokens[fg], tokens[bg])
                expect(r, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
            })
        }
    })

    describe(`${themeName}: faint text meets AA on the surfaces it sits on`, () => {
        // Raised from #94a3b8, which was 2.56:1 on white — below even AA Large,
        // and the colour of every timestamp and placeholder hint in the app. It
        // is held here on both the card surface and the sunk one, because faint
        // text appears on each.
        for (const bg of ["--surface", "--surface-sunk"]) {
            it(`--text-faint on ${bg}`, () => {
                const r = ratio(tokens["--text-faint"], tokens[bg])
                expect(r, `is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
            })
        }

        it("stays lighter than --text-soft, or the two tokens collapse into one", () => {
            const faint = luminance(tokens["--text-faint"])
            const soft = luminance(tokens["--text-soft"])
            // Lighter on light, lighter on dark — "faint" is a step away from
            // the body colour in whichever direction the ground goes.
            if (themeName === "light") expect(faint).toBeGreaterThan(soft)
            else expect(faint).toBeLessThan(soft)
        })
    })
}

describe("the keyboard focus ring stands out (WCAG 1.4.11, 3:1)", () => {
    // It was the browser's own ring, hidden on every .input and on about ten
    // controls (accessibility audit, 4 October 2026, H3); now one ring in a
    // colour held to 3:1 against what it sits on, in each theme.
    for (const [themeName, tokens] of [["light", LIGHT], ["dark", DARK]] as const) {
        for (const bg of ["--surface", "--surface-sunk", "--page-bg"]) {
            it(`${themeName}: --focus-ring on ${bg}`, () => {
                const r = ratio(tokens["--focus-ring"], tokens[bg])
                expect(r, `is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
            })
        }
    }

    it("on the sidebar, dark in both themes, it is the light ring", () => {
        // The side bar's own ring, which follows the brand colour (DESIGN.md
        // §2.1). Nizmo's indigo gives this one; lib/brand-colour-old-pages.test.ts
        // holds every other colour's to the same 3:1.
        expect(CSS).toMatch(/\.glass-dark \{[^}]*--focus-ring: var\(--sidebar-ring\);/)
        const ring = CSS.match(/^\s*--sidebar-ring: (#[0-9a-fA-F]{6});/m)?.[1]
        expect(ring).toBeDefined()
        // Against the sidebar's darkest ground (slate 900) and its lightest:
        // slate 900 at 65% over the light page (#eef2ff), which is #5d6475.
        expect(ratio(ring!, "#0f172a")).toBeGreaterThanOrEqual(3)
        expect(ratio(ring!, "#5d6475")).toBeGreaterThanOrEqual(3)
    })

    it("is shown for keyboard focus, and nothing turns it off", () => {
        expect(CSS).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--focus-ring\);/)
        expect(CSS).not.toMatch(/\.input:focus \{[^}]*outline: none/)
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

    it("white on a filled button is 4.5:1 across its whole gradient (was 4.47 and 4.23:1)", () => {
        expect(CSS).toMatch(/\.btn-primary \{\s*background: linear-gradient\(135deg, var\(--button-from\) 0%, var\(--button-to\) 100%\)/)
        for (const t of ["--button-from", "--button-to"]) expect(ratio("#ffffff", LIGHT[t])).toBeGreaterThanOrEqual(4.5)
    })

    it("white on the sign-in button is 4.5:1 (was 3.7:1)", () => {
        for (const t of ["--hero-from", "--hero-to"]) expect(ratio("#ffffff", LIGHT[t])).toBeGreaterThanOrEqual(4.5)
    })

    for (const [themeName, tokens] of [["light", LIGHT], ["dark", DARK]] as const) {
        it(`${themeName}: a brand-coloured link is 4.5:1 on the surface`, () => {
            expect(ratio(tokens["--link"], tokens["--surface"])).toBeGreaterThanOrEqual(4.5)
        })
        it(`${themeName}: a field's outline is 3:1 on the surface and the page (was 1.4:1)`, () => {
            for (const bg of ["--surface", "--page-bg"]) expect(ratio(tokens["--field-border"], tokens[bg])).toBeGreaterThanOrEqual(3)
        })
    }

    it("fields draw their outline in --field-border", () => {
        expect(CSS).toMatch(/\.input \{[^}]*border: 1px solid var\(--field-border\);/)
    })

    it("no text is coloured with a status colour's fill (-solid), only its text colour (-fg)", () => {
        // Red for errors, late dates and delete links, and green, amber and
        // blue status text, used the fill colours, 2.2 to 3.8:1 on white.
        const found = SCREENS.flatMap(f => [...readFileSync(f, "utf8").matchAll(/(?<![A-Za-z])color:[^,}\n]*var\(--(danger|ok|warn|info)-solid\)/g)].map(() => f))
        expect(found).toEqual([])
    })

    it("the sidebar's section headings use the sidebar's own text colour (were 1.2 to 3.7:1)", () => {
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        expect(shell).not.toContain("color: 'var(--text-faint)'")
        // One heading, drawn for each of the side bar's groups (lib/side-bar.ts).
        expect(shell.split("fontWeight: 600, color: 'var(--sidebar-fg)'").length - 1).toBe(1)
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
        // grounds, text on a filled accent button stays white wherever the page
        // ground goes, and the login hero gradient is a decorative statement
        // that does not follow the theme.
        //
        // --logo-plate is invariant for a different and stronger reason: the
        // sidebar it appears in is dark in *both* themes (--sidebar-bg is
        // slate-900 at 65% even in light mode), so the plate behind a customer's
        // logo is not following the page ground and must not be made to. Giving
        // it a dark value would make every white-background logo vanish into it
        // — the failure it exists to prevent.
        //
        // --sidebar-fg/-strong are invariant for exactly that reason: same
        // sidebar, other end of the contrast. So are --sidebar-ring, the focus
        // ring on it, and --sidebar-accent, the end of the company name. They exist because the nav links
        // used --panel-* — a surface token — as their text colour, so the dark
        // palette dutifully gave the labels the sidebar's own colour and they
        // disappeared. A dark value here would restore that bug under a name
        // that reads correct.
        //
        // --paper and --ink-on-paper are invariant because they are not on a
        // screen at all. They exist for the print stylesheet, where the ground
        // is a sheet of paper and the ink is toner, and neither follows what
        // the reader has their display set to. A dark value would produce a
        // payslip printed white on black: unreadable, and expensive in a way
        // whoever pressed Print finds out about afterwards.
        //
        // --map-* are invariant because they are drawn on map tiles, which
        // are light in both themes: a dark-mode ink would vanish into them.
        //
        // --cam-* are invariant because the face check's camera screen is
        // dark in both themes, as every camera's view is: the picture fills
        // it, and its guidance is light over it whatever the page around is.
        const INVARIANT = new Set([
            "--primary", "--primary-hover", "--secondary", "--accent",
            "--text-on-accent", "--hero-from", "--hero-to",
            "--logo-plate", "--sidebar-fg", "--sidebar-fg-strong", "--sidebar-ring", "--sidebar-accent",
            "--paper", "--ink-on-paper",
            "--button-from", "--button-to",
            "--map-pin", "--map-ink", "--map-halo", "--map-shadow",
            "--cam-ground", "--cam-ink", "--cam-done", "--cam-warn",
        ])

        const missing = Object.keys(LIGHT).filter(t => !(t in DARK) && !INVARIANT.has(t))
        expect(missing, `tokens with no dark value:\n${missing.join("\n")}`).toEqual([])
    })
})

describe("dark: brand-coloured text meets AA 4.5:1 on its surfaces", () => {
    // Found by measuring every page's text in the dark theme. The brand indigo
    // (--primary, #6366f1) was used as text there unchanged, 2.8:1 on the dark
    // surfaces, and the audit log's action names (--accent-deepest) 2.85:1.
    // --primary itself can't lighten in the dark theme, because white text sits
    // on it in buttons, so text uses --brand-primary-text.
    for (const fg of ["--brand-primary-text", "--accent-deepest"]) {
        for (const bg of ["--surface", "--surface-sunk"]) {
            it(`${fg} on ${bg}`, () => {
                const r = ratio(DARK[fg], DARK[bg])
                expect(r, `${fg} ${DARK[fg]} on ${bg} ${DARK[bg]} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
            })
        }
    }

    it("and screens colour brand text with it, not with the button colour", () => {
        const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
        const offenders = [...files("app"), ...files("components")].filter(f =>
            /color: (?:[^,}]*\? )?'var\(--(?:brand-primary|primary)\)'/.test(readFileSync(f, "utf8")))
        expect(offenders).toEqual([])
    })
})

describe("fills: white text on a status colour meets AA 4.5:1", () => {
    // Found by measuring every page's text in the dark theme: white on the
    // Approve button's green, the points badge's blue and an amber avatar was
    // 2.2 to 2.8:1, and much the same in the light theme. The -solid colours
    // are also text and strokes on the page, so the grounds under white text
    // are their own tokens, the same hues darkened.
    const FILLS = ["--ok-fill", "--info-fill",
        "--warn-fill", "--warn-fill-warm", "--danger-fill", "--danger-fill-hover", "--accent-fill"]

    for (const [themeName, tokens] of [["light", LIGHT], ["dark", DARK]] as const) {
        for (const fill of FILLS) {
            it(`${themeName}: white on ${fill}`, () => {
                expect(tokens[fill], `${fill} undefined in ${themeName}`).toBeDefined()
                const r = ratio(tokens["--text-on-accent"] ?? LIGHT["--text-on-accent"], tokens[fill])
                expect(r, `is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
            })
        }
    }

    // A badge or a dot is a shape: in the dark theme it must still stand out
    // from the card it's on (AA for graphics, 3:1). A hover shade shows only
    // under the pointer, so it's held to less.
    for (const fill of FILLS.filter(f => !f.endsWith("-hover"))) {
        it(`dark: ${fill} stands out from --surface`, () => {
            const r = ratio(DARK[fill], DARK["--surface"])
            expect(r, `is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
        })
    }

    it("screens put a fill, not a -solid colour, behind text", () => {
        const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
        const offenders = [...files("app"), ...files("components")].flatMap(f =>
            [...readFileSync(f, "utf8").matchAll(/background(?:Color)?: [^,\n]*?'var\(--((?:ok|info|warn|danger|accent)-solid[a-z-]*)\)'/g)]
                .map(m => `${f}: ${m[1]}`))
        expect(offenders).toEqual([])
    })
})
