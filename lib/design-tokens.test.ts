import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { contrast } from "@/lib/brand-colour"

/**
 * The building blocks' colours, held two ways.
 *
 * To DESIGN.md: it is the rulebook (UI_PLAN.md §7.3), so app/globals.css must
 * say exactly what its tables say. A change starts in DESIGN.md and this fails
 * until the stylesheet follows, or the other way round.
 *
 * To contrast: every pair the building blocks put together reads at 4.5:1 for
 * text and 3:1 for a field's edge, in both themes. The numbers in DESIGN.md's
 * tables are checked here rather than trusted.
 */

const CSS = readFileSync("app/globals.css", "utf8")
const DOC = readFileSync("DESIGN.md", "utf8")

const START = CSS.indexOf("Design tokens (DESIGN.md)")

function block(selector: string): Record<string, string> {
    const at = CSS.indexOf(selector, START)
    const body = CSS.slice(at, CSS.indexOf("\n}", at))
    return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/g)].map(m => [m[1], m[2]]))
}

const THEMES = { light: block(":root {"), dark: block(':root[data-theme="dark"] {') }

/** DESIGN.md §2.2: | `--token` | `#light` | `#dark` | ... | */
const NEUTRALS = [...DOC.matchAll(/^\| `(--[a-z0-9-]+)` \| `(#[0-9a-f]{6})` \| `(#[0-9a-f]{6})` \|/gm)]
    .map(m => ({ token: m[1], light: m[2], dark: m[3] }))

/** DESIGN.md §2.3: | Meaning | statuses | `#bg` / `#fg` (n:1) | `#bg` / `#fg` (n:1) | */
const MEANING_TOKEN: Record<string, string> = {
    "Neutral": "neutral", "In motion": "progress", "Waiting on someone": "waiting", "Done or good": "good", "Problem": "problem",
}
const STATUSES = [...DOC.matchAll(/^\| ([A-Za-z ]+) \| [^|]+ \| `(#[0-9a-f]{6})` \/ `(#[0-9a-f]{6})` \(([\d.]+):1\) \| `(#[0-9a-f]{6})` \/ `(#[0-9a-f]{6})` \(([\d.]+):1\) \|/gm)]
    .map(m => ({ name: m[1], light: { bg: m[2], fg: m[3], ratio: Number(m[4]) }, dark: { bg: m[5], fg: m[6], ratio: Number(m[7]) } }))

describe("the stylesheet says what DESIGN.md says", () => {
    it("found the tokens and DESIGN.md's tables", () => {
        expect(START).toBeGreaterThan(0)
        expect(NEUTRALS.map(n => n.token)).toEqual(["--page", "--panel", "--panel-raised", "--ink", "--ink-2", "--muted", "--rule", "--field-line"])
        expect(STATUSES.map(s => s.name)).toEqual(Object.keys(MEANING_TOKEN))
    })

    it.each(["light", "dark"] as const)("neutrals, %s", theme => {
        for (const n of NEUTRALS) expect([n.token, THEMES[theme][n.token]]).toEqual([n.token, n[theme]])
    })

    it.each(["light", "dark"] as const)("status colours, %s", theme => {
        for (const s of STATUSES) {
            const key = MEANING_TOKEN[s.name]
            expect(THEMES[theme][`--status-${key}-bg`]).toBe(s[theme].bg)
            expect(THEMES[theme][`--status-${key}-fg`]).toBe(s[theme].fg)
            // The ratio DESIGN.md prints is the real one, to its one decimal.
            expect(Math.abs(contrast(s[theme].fg, s[theme].bg) - s[theme].ratio)).toBeLessThan(0.06)
        }
    })

    it("the overdue row and danger colours", () => {
        expect(DOC).toContain("`#fff8fa` in light mode,\n  `#241729` in dark")
        expect(THEMES.light["--overdue-row"]).toBe("#fff8fa")
        expect(THEMES.dark["--overdue-row"]).toBe("#241729")
        expect(DOC).toContain("**Danger text** on white is `#b3093c`")
        expect(THEMES.light["--problem-text"]).toBe("#b3093c")
        expect(THEMES.light["--problem-fill"]).toBe("#b3093c")
    })
})

describe("every pair reads", () => {
    it.each(["light", "dark"] as const)("text, %s", theme => {
        const t = THEMES[theme]
        const ground = (name: string) => t[name] ?? THEMES.light[name]
        const pairs: [string, string][] = [
            ...["--ink", "--ink-2", "--muted"].flatMap(fg => ["--page", "--panel", "--panel-raised", "--brand-tint", "--overdue-row"].map(bg => [fg, bg] as [string, string])),
            ["--problem-text", "--panel"],
            ["--problem-text", "--overdue-row"],
            ["--on-brand", "--brand"],
            ...["neutral", "progress", "waiting", "good", "problem"].map(k => [`--status-${k}-fg`, `--status-${k}-bg`] as [string, string]),
        ]
        for (const [fg, bg] of pairs) {
            expect([theme, fg, bg, contrast(t[fg], ground(bg)) >= 4.5]).toEqual([theme, fg, bg, true])
        }
        // White on the danger button, which is the same in both themes.
        expect(contrast("#ffffff", THEMES.light["--problem-fill"])).toBeGreaterThanOrEqual(4.5)
    })

    it.each(["light", "dark"] as const)("a field's edge stands out at 3:1, %s", theme => {
        const t = THEMES[theme]
        for (const bg of ["--page", "--panel", "--panel-raised"]) {
            expect([bg, contrast(t["--field-line"], t[bg]) >= 3]).toEqual([bg, true])
        }
    })
})
