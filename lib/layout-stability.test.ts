import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Pages don't jump while they load (Lighthouse: Cumulative Layout Shift). The
 * worst were 0.85 on a phone, where the first paint was the desktop layout
 * and the page then slid 270px into place, and 0.2 to 0.26 on the Super
 * Admin's health and settings pages, where a card appeared late and pushed
 * the others along.
 */
describe("the dashboard's layout on a phone", () => {
    const shell = readFileSync("components/DashboardShell.tsx", "utf8")
    const css = readFileSync("app/globals.css", "utf8")

    it("is decided by CSS, so the first paint is already right", () => {
        expect(shell).toContain('<main className="shell-main"')
        expect(shell).toContain("['--shell-sidebar' as string]: sidebarWidth")
        expect(shell).not.toMatch(/marginLeft'\]: \(!isMobile\)/)
        expect(shell).toContain('className="glass-dark shell-aside"')
        expect(shell).not.toMatch(/transform: \(isMobile && !isSidebarOpen\)/)
        expect(shell).not.toMatch(/\.\.\.\(isMobile\s*\? \{\s*position: 'static'/)
    })

    it("hides the sidebar and drops the margin below 1024px", () => {
        const phone = css.slice(css.indexOf(".shell-main {"), css.indexOf("/* Responsive Utilities */"))
        expect(phone).toContain("margin-inline-start: var(--shell-sidebar, 270px);")
        expect(phone).toMatch(/@media \(max-width: 1023px\) \{[\s\S]*\.shell-main \{\s*margin-inline-start: 0;[\s\S]*\.shell-aside:not\(\[data-open="true"\]\) \{\s*transform: translateX\(-100%\);[\s\S]*\.shell-aside\[data-rtl="true"\]:not\(\[data-open="true"\]\) \{\s*transform: translateX\(100%\);/)
    })
})

describe("cards that load their own data", () => {
    it.each([
        ["components/TerminalsHealthCard.tsx", "att_term_health_title"],
        ["components/FaceSystemSwitch.tsx", "face_sys_title"],
    ])("%s holds its place while it loads", (f, title) => {
        const src = readFileSync(f, "utf8")
        expect(src).not.toMatch(/if \(!(rows|data)\) return null/)
        const loading = src.slice(src.search(/if \(!(rows|data)\) \{/), src.search(/if \(!(rows|data)\) \{/) + 900)
        expect(loading).toContain(`t('${title}')`)
        expect(loading).toContain("t('loading')")
    })
})
