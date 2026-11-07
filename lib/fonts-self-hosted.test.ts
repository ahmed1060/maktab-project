import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The typefaces are self-hosted through next/font (Lighthouse: "eliminate
 * render-blocking resources", about 0.8 s on a phone, on every page). Before,
 * globals.css @imported them from fonts.googleapis.com: a stylesheet that held
 * back the first paint until it had loaded, and only then asked for the fonts.
 */
describe("fonts", () => {
    const css = readFileSync("app/globals.css", "utf8")
    const layout = readFileSync("app/layout.tsx", "utf8")
    // Defined once, in a font definitions file, for the root layout and for the
    // screen when the app itself broke, which draws its own page (PR 219).
    const fonts = readFileSync("app/fonts.ts", "utf8")

    it("are not fetched from Google at page load", () => {
        expect(css).not.toContain("fonts.googleapis.com")
        expect(layout).not.toContain("fonts.googleapis.com")
        expect(fonts).not.toContain("fonts.googleapis.com")
    })

    it("come from next/font, as CSS variables on <html>", () => {
        expect(fonts).toContain("import { Outfit, Inter, Noto_Sans_Arabic } from 'next/font/google'")
        expect(fonts).toMatch(/variable: '--font-outfit'/)
        expect(fonts).toMatch(/variable: '--font-inter'/)
        expect(fonts).toMatch(/variable: '--font-noto-arabic'/)
        expect(fonts).toContain("export const fontVariables = `${outfit.variable} ${inter.variable} ${notoArabic.variable}`")
        expect(layout).toContain("import { fontVariables } from './fonts'")
        expect(layout).toContain("className={fontVariables}")
        expect(layout).not.toContain("next/font")
        expect(readFileSync("app/global-error.tsx", "utf8")).toContain("className={fontVariables}")
    })

    it("the Arabic one isn't preloaded, as only the building blocks use it so far", () => {
        // Preloaded, every English page would fetch it for nothing.
        expect(fonts).toMatch(/Noto_Sans_Arabic\(\{[^}]*subsets: \['arabic'\][^}]*preload: false/)
        expect(css).toContain("--font-ui: var(--font-inter), var(--font-noto-arabic), system-ui, sans-serif;")
    })

    it("are used through those variables", () => {
        expect(css).toContain("font-family: var(--font-outfit), var(--font-inter), sans-serif;")
        expect(readFileSync("components/DashboardShell.tsx", "utf8")).not.toContain("'Inter', sans-serif")
    })
})
