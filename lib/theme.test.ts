import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { THEMES, DEFAULT_THEME, LEGACY_THEME, isTheme, parseTheme, themeAttribute } from "./theme"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

describe("two states", () => {
    it("offers light and dark, and nothing else", () => {
        expect([...THEMES].sort()).toEqual(["dark", "light"])
    })

    it("defaults to light", () => {
        // Decided rather than derived: the alternative was resolving each
        // person against their operating system once, and the call was to map
        // everyone who had never chosen to light instead.
        expect(DEFAULT_THEME).toBe("light")
    })

    it("rejects anything else rather than trusting a cookie", () => {
        // The value arrives from a cookie, which anyone can edit.
        expect(isTheme("dark")).toBe(true)
        expect(isTheme("DARK")).toBe(false)
        expect(isTheme("")).toBe(false)
        expect(isTheme(null)).toBe(false)
        expect(isTheme("light; --evil: 1")).toBe(false)
        expect(parseTheme("nonsense")).toBe("light")
        expect(parseTheme(undefined)).toBe("light")
    })
})

describe("retiring the third state", () => {
    it("folds a stored 'system' into the default without a branch for it", () => {
        // 20 of 22 accounts were on this, and it is also sitting in cookies and
        // in session tokens issued before the change. Nothing anywhere has to
        // know about it: it simply is not a theme, so it parses to the default.
        expect(isTheme(LEGACY_THEME)).toBe(false)
        expect(parseTheme(LEGACY_THEME)).toBe(DEFAULT_THEME)
    })

    it("is not offered by the toggle", () => {
        expect([...THEMES] as string[]).not.toContain(LEGACY_THEME)
    })
})

describe("what gets stamped on <html>", () => {
    it("always stamps something", () => {
        // While "system" existed this returned undefined for it, because that
        // state had to be served by the media query alone. Every render being
        // stamped is what makes the media copy of the dark palette dead weight.
        for (const theme of THEMES) {
            expect(themeAttribute(theme)).toBe(theme)
        }
    })
})

// The media-query copy of the dark palette is now unreachable: the root is
// always stamped, so :root:not([data-theme="light"]) can only match when the
// stamp says dark, which the explicit block already handles. These assertions
// hold until the contract step deletes that copy — they are kept until then so
// the two do not drift while both exist.
describe("the CSS answers both states", () => {
    const CSS = readFileSync("app/globals.css", "utf8")

    it("has a media query that yields to an explicit light choice", () => {
        // Without :not([data-theme="light"]), somebody on a dark OS who picks
        // light would still get dark.
        expect(CSS).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*?:root:not\(\[data-theme="light"\]\)/)
    })

    it("has an explicit dark block that wins on a light system", () => {
        expect(CSS).toContain(':root[data-theme="dark"]')
    })

    it("declares color-scheme in both directions", () => {
        // Without it a dark page keeps white scrollbars and light form controls.
        expect(CSS).toMatch(/color-scheme:\s*light/)
        expect(CSS).toMatch(/color-scheme:\s*dark/)
    })

    it("keeps the two dark palettes identical", () => {
        // They are duplicated because a custom property cannot be applied
        // conditionally any other way; if they drift, the same person sees two
        // different dark modes depending on their OS setting.
        const tokensIn = (selector: string) => {
            const at = CSS.indexOf(selector)
            const body = CSS.slice(at, CSS.indexOf("\n  }", at))
            return [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
                .map(m => `${m[1]}:${m[2].trim()}`).sort()
        }
        const viaMedia = tokensIn("@media (prefers-color-scheme: dark)")
        const viaAttr = tokensIn(':root[data-theme="dark"]')
        expect(viaMedia.length).toBeGreaterThan(50)
        expect(viaAttr).toEqual(viaMedia)
    })
})

describe("the toggle's labels", () => {
    for (const key of ["theme_label", "theme_light", "theme_dark"]) {
        it(key, () => {
            expect(en).toHaveProperty(key)
            expect(ar).toHaveProperty(key)
        })
    }

    it("names both states, since the toggle shows both at once", () => {
        for (const theme of THEMES) {
            expect(en, theme).toHaveProperty(`theme_${theme}`)
            expect(ar, theme).toHaveProperty(`theme_${theme}`)
        }
    })
})

describe("the third state is gone from the UI, not just from the type", () => {
    // Comments stripped: this file's own prose explains at length what "system"
    // was, and a plain substring check would match that instead of the code —
    // which is how three earlier guards in this repo passed while the thing
    // they forbade was still there.
    const code = (path: string) =>
        readFileSync(path, "utf8")
            .split("\n")
            .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .join("\n")

    it("is not offered, labelled or branched on by the toggle", () => {
        expect(code("components/ThemeToggleButton.tsx")).not.toContain("system")
    })

    it("is not special-cased when applying a theme", () => {
        // The old apply() removed the data-theme attribute for it, so the media
        // query could take back over. Leaving that branch in would mean a stale
        // cookie could still produce an unstamped root.
        expect(code("context/ThemeContext.tsx")).not.toContain("removeAttribute")
    })

    it("still defaults both account tables to light, not one of them", () => {
        // Super Admins live in their own table. Fixing one column and missing
        // the other is the easy mistake, and nothing would report it.
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const defaults = [...schema.matchAll(/theme\s+String\s+@default\("([a-z]+)"\)/g)].map(m => m[1])
        expect(defaults).toEqual(["light", "light"])
    })
})
