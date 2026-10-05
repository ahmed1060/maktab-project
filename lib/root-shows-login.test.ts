import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * A signed-out visit to / shows the login page there, rather than redirecting
 * to /login (Lighthouse: "avoid multiple page redirects", up to 0.75 s on a
 * phone, on every first visit). Signed in, / still goes to the dashboard.
 */
describe("the site's root", () => {
    const proxy = readFileSync("proxy.ts", "utf8")

    it("is rewritten to the login page when signed out", () => {
        expect(proxy).toMatch(/if \(!token && pathname === '\/'\) \{\s*return NextResponse\.rewrite\(new URL\('\/login', req\.url\)\)/)
    })

    it("still sends someone signed in to the dashboard", () => {
        expect(proxy).toMatch(/if \(token && \(pathname === '\/login' \|\| pathname === '\/'\)\) \{\s*return NextResponse\.redirect\(new URL\('\/dashboard', req\.url\)\)/)
    })
})
