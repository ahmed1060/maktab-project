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

    describe(`${themeName}: faint text`, () => {
        it("--text-faint on --surface", () => {
            const r = ratio(tokens["--text-faint"], tokens["--surface"])

            if (themeName === "light") {
                // KNOWN, PRE-EXISTING, and not introduced by dark mode: #94a3b8
                // on white is 2.56:1, below even AA Large. It has been the
                // colour of every timestamp and placeholder hint in this app
                // since long before this work, and the plan for dark mode is
                // explicit that light mode stays exactly as it is — so it is
                // recorded here rather than quietly changed or quietly excused.
                //
                // Asserted as a bound, not skipped: if it ever gets worse this
                // fails, and when somebody decides to fix light mode the number
                // below is what they raise.
                expect(r).toBeGreaterThanOrEqual(2.5)
                expect(r, "light --text-faint is a known AA failure; see comment").toBeLessThan(3)
                return
            }

            // Dark is new, so it is held to the bar from the start.
            expect(r, `is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
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
        const INVARIANT = new Set([
            "--primary", "--primary-hover", "--secondary", "--accent",
            "--text-on-accent", "--hero-from", "--hero-to",
        ])

        const missing = Object.keys(LIGHT).filter(t => !(t in DARK) && !INVARIANT.has(t))
        expect(missing, `tokens with no dark value:\n${missing.join("\n")}`).toEqual([])
    })
})
