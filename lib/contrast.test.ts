import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

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
    ["--lifetime-fg", "--lifetime-bg"],
    ["--accent-fg", "--lifetime-bg"],
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
        // sidebar, other end of the contrast. They exist because the nav links
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
        const INVARIANT = new Set([
            "--primary", "--primary-hover", "--secondary", "--accent",
            "--text-on-accent", "--hero-from", "--hero-to",
            "--logo-plate", "--sidebar-fg", "--sidebar-fg-strong",
            "--paper", "--ink-on-paper",
        ])

        const missing = Object.keys(LIGHT).filter(t => !(t in DARK) && !INVARIANT.has(t))
        expect(missing, `tokens with no dark value:\n${missing.join("\n")}`).toEqual([])
    })
})
