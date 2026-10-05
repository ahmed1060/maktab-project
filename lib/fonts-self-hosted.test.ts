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

    it("are not fetched from Google at page load", () => {
        expect(css).not.toContain("fonts.googleapis.com")
        expect(layout).not.toContain("fonts.googleapis.com")
    })

    it("come from next/font, as CSS variables on <html>", () => {
        expect(layout).toContain("import { Outfit, Inter } from 'next/font/google'")
        expect(layout).toMatch(/variable: '--font-outfit'/)
        expect(layout).toMatch(/variable: '--font-inter'/)
        expect(layout).toContain("className={`${outfit.variable} ${inter.variable}`}")
    })

    it("are used through those variables", () => {
        expect(css).toContain("font-family: var(--font-outfit), var(--font-inter), sans-serif;")
        expect(readFileSync("components/DashboardShell.tsx", "utf8")).not.toContain("'Inter', sans-serif")
    })
})
