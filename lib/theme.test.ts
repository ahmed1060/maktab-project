import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { THEMES, DEFAULT_THEME, isTheme, parseTheme, themeAttribute } from "./theme"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

describe("three states, not a boolean", () => {
    it("offers light, dark and system", () => {
        expect([...THEMES].sort()).toEqual(["dark", "light", "system"])
    })

    it("defaults to following the operating system", () => {
        // Defaulting anyone to an explicit choice they never made overrides the
        // preference their OS already carries.
        expect(DEFAULT_THEME).toBe("system")
    })

    it("rejects anything else rather than trusting a cookie", () => {
        // The value arrives from a cookie, which anyone can edit.
        expect(isTheme("dark")).toBe(true)
        expect(isTheme("DARK")).toBe(false)
        expect(isTheme("")).toBe(false)
        expect(isTheme(null)).toBe(false)
        expect(isTheme("light; --evil: 1")).toBe(false)
        expect(parseTheme("nonsense")).toBe("system")
        expect(parseTheme(undefined)).toBe("system")
    })
})

describe("what gets stamped on <html>", () => {
    it("stamps nothing for system, so the media query alone serves it", () => {
        // An attribute here would have to win against prefers-color-scheme in
        // both directions, which is what the three CSS blocks avoid.
        expect(themeAttribute("system")).toBeUndefined()
    })

    it("stamps each explicit choice, so it wins over the system either way", () => {
        expect(themeAttribute("dark")).toBe("dark")
        expect(themeAttribute("light")).toBe("light")
    })
})

describe("the CSS answers all three states", () => {
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
    for (const key of ["theme_label", "theme_light", "theme_dark", "theme_system"]) {
        it(key, () => {
            expect(en).toHaveProperty(key)
            expect(ar).toHaveProperty(key)
        })
    }

    it("names every state, so the cycle can label whichever it lands on", () => {
        for (const theme of THEMES) {
            expect(en, theme).toHaveProperty(`theme_${theme}`)
            expect(ar, theme).toHaveProperty(`theme_${theme}`)
        }
    })
})
