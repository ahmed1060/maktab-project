import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * "Reduce motion" is honoured everywhere (WCAG 2.2.2, 2.3.3; accessibility
 * audit, 4 October 2026, M5). Before, only the notice popup did: the page
 * background drifted forever and cards jumped 5px on hover for everyone.
 */
const css = readFileSync("app/globals.css", "utf8")
const start = css.indexOf("@media (prefers-reduced-motion: reduce)")
const block = start < 0 ? "" : css.slice(start, css.indexOf("\n}\n", start))

describe("reduce motion", () => {
    it("has a rule in the global stylesheet", () => {
        expect(start).toBeGreaterThan(-1)
    })

    it("stops animations and transitions on everything", () => {
        expect(block).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration: 0\.01ms !important;[^}]*animation-iteration-count: 1 !important;[^}]*transition-duration: 0\.01ms !important;/)
    })

    it("stops the cards lifting on hover", () => {
        for (const sel of [".glass-card:hover", ".card:hover", ".btn-primary:hover"]) expect(block).toContain(sel)
        expect(block).toMatch(/transform: none !important/)
    })

    it("keeps loading spinners turning, as they say the page is working", () => {
        expect(block).toMatch(/\[class\*="spin"\],\s*\[style\*="spin"\]\s*\{[^}]*animation-iteration-count: infinite !important/)
    })
})
