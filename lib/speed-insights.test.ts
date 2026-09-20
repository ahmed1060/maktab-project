import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Field performance metrics, and the one thing worth checking about them.
 *
 * This app's routes are full of identifiers — /dashboard/employees/<uuid>,
 * /dashboard/tasks/<uuid> — so a metrics tool that reported raw paths would be
 * exporting them to a third party as a side effect of measuring page speed.
 *
 * The Next entry point does not: its computeRoute substitutes each dynamic
 * param back into the pattern before reporting. That is a property of the
 * package rather than of this repo, so the test below reads the package, and
 * fails if a future version drops it. Then there would be a real decision to
 * make, rather than a silent change in what leaves the browser.
 */

const LAYOUT = stripComments(readFileSync("app/layout.tsx", "utf8"))

describe("speed insights is wired into the root layout", () => {
    it("imports the Next entry point, not the generic one", () => {
        // The generic entry has no router access, so it reports window.location
        // — the raw path, identifiers and all.
        expect(LAYOUT).toContain('from \'@vercel/speed-insights/next\'')
    })

    it("renders it", () => {
        expect(LAYOUT).toMatch(/<SpeedInsights\s*\/>/)
    })
})

describe("what it reports is the route, not the URL", () => {
    const pkg = readFileSync("node_modules/@vercel/speed-insights/dist/next/index.mjs", "utf8")

    it("still rewrites dynamic segments back into the pattern", () => {
        // If this disappears in a version bump, /dashboard/employees/<uuid>
        // starts being sent verbatim.
        expect(pkg).toContain("function computeRoute")
        expect(pkg).toMatch(/result\.replace\(matcher, `\/\[\$\{key\}\]`\)/)
    })

    it("is loaded from this origin, so the CSP needs nothing new", () => {
        // Same-origin script and beacon, covered by script-src 'self' in
        // next.config.mjs — which matters mostly for the day that policy stops
        // being Report-Only.
        expect(pkg).toContain("/_vercel/speed-insights/script.js")
        expect(pkg).not.toMatch(/https:\/\/(?!vercel\.com)[a-z.]*vitals/)
    })
})
