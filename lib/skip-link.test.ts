import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Every dashboard page started with 10 to 20 sidebar links before its
 * content, with no way past them, and nothing said which page you were on
 * (WCAG 2.4.1, 1.3.1; accessibility audit of 4 October 2026, M3).
 */
const SHELL = readFileSync("components/DashboardShell.tsx", "utf8")
const SIDE_BAR = readFileSync("components/SideBar.tsx", "utf8")
const CSS = readFileSync("app/globals.css", "utf8")
const UI = readFileSync("components/ui/ui.css", "utf8")

describe("getting past the sidebar", () => {
    it("a Skip to content link comes before the sidebar and goes to the page, past the header", () => {
        const skip = SHELL.indexOf('<a href="#main-content" className="skip-link">')
        expect(skip).toBeGreaterThan(-1)
        expect(skip).toBeLessThan(SHELL.indexOf("<SideBar"))
        // After the header: its bell and account menu repeat on every page too
        // (Codex review on #37).
        const target = SHELL.indexOf('<div id="main-content" tabIndex={-1}')
        expect(target).toBeGreaterThan(SHELL.indexOf("<DashboardHeader"))
        expect(SHELL.indexOf("{children}", target)).toBeGreaterThan(target)
    })

    it("is hidden until Tab reaches it, then shown", () => {
        expect(CSS).toMatch(/\.skip-link \{[^}]*top: -100px/)
        expect(CSS).toMatch(/\.skip-link:focus \{\s*top: 1rem;/)
    })
})

describe("the sidebar says where you are", () => {
    it("every sidebar link can be marked as the current page, and is drawn so", () => {
        // The side bar's own file since it moved onto the building blocks (DESIGN.md §5.1).
        const links = [...SIDE_BAR.matchAll(/<Link\b[^>]*?href=/g)].length
        const marked = [...SIDE_BAR.matchAll(/\{\.\.\.currentFor\(/g)].length
        // One link, drawn for every item of every group (lib/side-bar.ts).
        expect(links).toBeGreaterThanOrEqual(1)
        expect(marked).toBe(links)
        expect(SIDE_BAR).toContain("{ 'aria-current': 'page' as const }")
        expect(UI).toContain('.ui-side-item[aria-current="page"]')
        expect(CSS).not.toContain(".nav-link")
    })

    it("the dashboard link is current only on the dashboard itself", () => {
        expect(SIDE_BAR).toContain("href !== '/dashboard' && !!pathname?.startsWith(href + '/')")
    })
})
