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

/**
 * DESIGN.md §2.2's glass top bar: | `--header-…` | `light` | `dark` |. These
 * are the app's older tokens, kept with the bar's glass (§5.1), so they're
 * declared in the stylesheet's first :root blocks, not the ones above
 * (Codex on #85).
 */
const GLASS = [...DOC.matchAll(/^\| `(--header-[a-z-]+)` \| `([^`]+)` \| `([^`]+)` \|/gm)]
    .map(m => ({ token: m[1], light: m[2], dark: m[3] }))

/** A token as the first block for `selector` declares it, its spacing as one space. */
function declared(selector: string, token: string): string | undefined {
    const at = CSS.indexOf(selector)
    const body = CSS.slice(at, CSS.indexOf("\n}", at))
    return body.match(new RegExp(`${token}\\s*:\\s*([^;]+);`))?.[1].replace(/\s+/g, " ").trim()
}

/** DESIGN.md §2.3: | Meaning | statuses | `#bg` / `#fg` (n:1) | `#bg` / `#fg` (n:1) | */
const MEANING_TOKEN: Record<string, string> = {
    "Neutral": "neutral", "In motion": "progress", "Waiting on someone": "waiting", "Done or good": "good", "Problem": "problem",
}
const STATUSES = [...DOC.matchAll(/^\| ([A-Za-z ]+) \| [^|]+ \| `(#[0-9a-f]{6})` \/ `(#[0-9a-f]{6})` \(([\d.]+):1\) \| `(#[0-9a-f]{6})` \/ `(#[0-9a-f]{6})` \(([\d.]+):1\) \|/gm)]
    .map(m => ({ name: m[1], light: { bg: m[2], fg: m[3], ratio: Number(m[4]) }, dark: { bg: m[5], fg: m[6], ratio: Number(m[7]) } }))

/** DESIGN.md §2.3's chart colours: | Meaning | `--chart-x` `#light` (n:1) | `#dark` (n:1) | */
const CHARTS = [...DOC.matchAll(/^ {2}\| [A-Za-z ]+ \| `(--chart-[a-z]+)` `(#[0-9a-f]{6})` \(([\d.]+):1\) \| `(#[0-9a-f]{6})` \(([\d.]+):1\) \|/gm)]
    .map(m => ({ token: m[1], light: { value: m[2], ratio: Number(m[3]) }, dark: { value: m[4], ratio: Number(m[5]) } }))

describe("the stylesheet says what DESIGN.md says", () => {
    it("found the tokens and DESIGN.md's tables", () => {
        expect(START).toBeGreaterThan(0)
        expect(NEUTRALS.map(n => n.token)).toEqual(["--page", "--panel", "--panel-raised", "--ink", "--ink-2", "--muted", "--rule", "--field-line"])
        expect(STATUSES.map(s => s.name)).toEqual(Object.keys(MEANING_TOKEN))
    })

    it.each(["light", "dark"] as const)("neutrals, %s", theme => {
        for (const n of NEUTRALS) expect([n.token, THEMES[theme][n.token]]).toEqual([n.token, n[theme]])
    })

    it("the glass top bar's tokens, in both themes", () => {
        expect(GLASS.map(g => g.token)).toEqual(["--header-glass-bg", "--header-glass-border", "--header-shadow"])
        for (const g of GLASS) {
            expect([g.token, declared(":root {", g.token)]).toEqual([g.token, g.light])
            expect([g.token, declared(':root[data-theme="dark"] {', g.token)]).toEqual([g.token, g.dark])
        }
    })

    it("text on the glass top bar reads at 4.5:1 whatever scrolls under it, though helper text wouldn't", () => {
        // The glass over black is its darkest, behind light mode's dark text;
        // over white, its lightest, behind dark mode's light text (Codex on #85).
        const glass = (theme: "light" | "dark") => {
            const [r, g, b, a] = GLASS.find(x => x.token === "--header-glass-bg")![theme].match(/[\d.]+/g)!.map(Number)
            const under = theme === "light" ? 0 : 255
            return "#" + [r, g, b].map(c => Math.round(c * a + under * (1 - a)).toString(16).padStart(2, "0")).join("")
        }
        expect([glass("light"), glass("dark")]).toEqual(["#d1d1d1", "#2a2e33"])
        for (const theme of ["light", "dark"] as const) {
            for (const token of ["--ink", "--ink-2"]) expect([theme, token, contrast(THEMES[theme][token], glass(theme)) >= 4.5]).toEqual([theme, token, true])
        }
        expect(contrast(THEMES.light["--muted"], glass("light"))).toBeLessThan(4.5)
        expect(DOC).toContain("text and icons on the bar are `--ink` or `--ink-2`, never `--muted`.")
        expect(DOC).toContain("`--muted` reads only 3.5:1 on the first; `--ink-2` reads 7.7:1 on both;")
        expect(contrast(THEMES.light["--muted"], glass("light")).toFixed(1)).toBe("3.5")
        expect(Math.min(contrast(THEMES.light["--ink-2"], glass("light")), contrast(THEMES.dark["--ink-2"], glass("dark"))).toFixed(1)).toBe("7.7")
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

    it.each(["light", "dark"] as const)("chart colours, %s", theme => {
        expect(CHARTS.map(c => c.token)).toEqual(["--chart-neutral", "--chart-progress", "--chart-waiting", "--chart-good", "--chart-problem"])
        for (const c of CHARTS) {
            expect([c.token, THEMES[theme][c.token]]).toEqual([c.token, c[theme].value])
            // The ratio DESIGN.md prints is against a panel, to its one decimal.
            expect(Math.abs(contrast(c[theme].value, THEMES[theme]["--panel"]) - c[theme].ratio)).toBeLessThan(0.06)
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
        // The danger button and its hover are the same in both themes.
        for (const fill of ["--problem-fill", "--problem-fill-hover"]) {
            expect(contrast(THEMES.light["--on-problem"], THEMES.light[fill])).toBeGreaterThanOrEqual(4.5)
        }
    })

    it.each(["light", "dark"] as const)("a chart's parts stand out at 3:1 on every ground a chart sits on, %s", theme => {
        const t = THEMES[theme]
        for (const c of CHARTS) for (const bg of ["--panel", "--panel-raised"]) {
            expect([c.token, bg, contrast(t[c.token], t[bg] ?? THEMES.light[bg]) >= 3]).toEqual([c.token, bg, true])
        }
    })

    it.each(["light", "dark"] as const)("a field's edge stands out at 3:1, %s", theme => {
        const t = THEMES[theme]
        for (const bg of ["--page", "--panel", "--panel-raised"]) {
            expect([bg, contrast(t["--field-line"], t[bg]) >= 3]).toEqual([bg, true])
        }
    })
})
