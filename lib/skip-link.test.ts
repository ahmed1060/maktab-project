import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Every dashboard page started with 10 to 20 sidebar links before its
 * content, with no way past them, and nothing said which page you were on
 * (WCAG 2.4.1, 1.3.1; accessibility audit of 4 October 2026, M3).
 */
const SHELL = readFileSync("components/DashboardShell.tsx", "utf8")
const CSS = readFileSync("app/globals.css", "utf8")

describe("getting past the sidebar", () => {
    it("a Skip to content link comes before the sidebar and goes to the page's main region", () => {
        const skip = SHELL.indexOf('<a href="#main-content" className="skip-link">')
        expect(skip).toBeGreaterThan(-1)
        expect(skip).toBeLessThan(SHELL.indexOf("<aside"))
        expect(SHELL).toMatch(/<main id="main-content" tabIndex=\{-1\}/)
    })

    it("is hidden until Tab reaches it, then shown", () => {
        expect(CSS).toMatch(/\.skip-link \{[^}]*top: -100px/)
        expect(CSS).toMatch(/\.skip-link:focus \{\s*top: 1rem;/)
    })
})

describe("the sidebar says where you are", () => {
    it("every sidebar link can be marked as the current page, and is drawn so", () => {
        const links = [...SHELL.matchAll(/<Link\b[^>]*?href=/g)].length
        const marked = [...SHELL.matchAll(/\{\.\.\.currentFor\(/g)].length
        expect(links).toBeGreaterThanOrEqual(9)
        expect(marked).toBe(links)
        expect(SHELL).toContain("{ 'aria-current': 'page' as const }")
        expect(CSS).toContain('.nav-link[aria-current="page"]')
    })

    it("the dashboard link is current only on the dashboard itself", () => {
        expect(SHELL).toContain("href !== '/dashboard' && pathname?.startsWith(href + '/')")
    })
})
