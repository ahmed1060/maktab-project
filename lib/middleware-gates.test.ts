import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"

/**
 * The dashboard gates are four redirects in middleware.ts, each holding a user
 * on one page until a condition clears. Every one of them has the same failure
 * mode, and it is total: if the page a gate redirects *to* is not also the page
 * that gate lets *through*, the user bounces between the two until the browser
 * gives up. There is no error, no log, and no way out from inside the app.
 *
 * That is not a hypothetical risk here. Merging the email screen into Security
 * Settings moved the page a gate points at while leaving a redirect behind at
 * the old path, which is exactly the shape that produces the loop.
 *
 * Read as source rather than executed: middleware.ts throws at import without
 * NEXTAUTH_SECRET, and the thing worth pinning is the pairing, not the routing.
 */
const SOURCE = readFileSync("middleware.ts", "utf8")

// Each gate: the path it excludes from itself, and the path it sends people to.
const GATES = [
    { name: "forced password change", page: "/dashboard/change-password" },
    { name: "unverified email", page: "/dashboard/security-settings" },
    { name: "maintenance mode", page: "/dashboard/maintenance" },
    { name: "subscription lockout", page: "/dashboard/subscription-expired" },
]

describe("every gate lets through the page it redirects to", () => {
    it.each(GATES.map(g => [g.name, g.page]))("%s → %s", (_name, page) => {
        expect(SOURCE, `nothing is excluded for ${page}`).toContain(`pathname !== '${page}'`)
        expect(SOURCE, `nothing redirects to ${page}`).toContain(`new URL('${page}', req.url)`)
    })

    it("has a real page behind each of those paths", () => {
        // A gate pointing at a route with no page is the same dead end by a
        // different route.
        for (const { page } of GATES) {
            const file = `app/(dashboard)${page}/page.tsx`
            expect(existsSync(file), `${page} has no page.tsx`).toBe(true)
        }
    })

    it("sends the unverified to Security Settings, not to the path it replaced", () => {
        // /dashboard/email-settings still resolves — it is a redirect stub, for
        // the bookmarks this gate created over the life of the feature. Naming
        // it here again would mean the gate lets that path through while the
        // page immediately forwards, which is the loop.
        expect(SOURCE).not.toContain("pathname !== '/dashboard/email-settings'")
        expect(SOURCE).not.toContain("new URL('/dashboard/email-settings'")
    })
})

describe("the routes that moved still answer", () => {
    it.each([
        ["/dashboard/email-settings"],
        ["/dashboard/mfa-settings"],
    ])("%s redirects rather than 404s", (page) => {
        const file = `app/(dashboard)${page}/page.tsx`
        expect(existsSync(file), `${page} was deleted rather than redirected`).toBe(true)
        const source = readFileSync(file, "utf8")
        expect(source).toContain("redirect('/dashboard/security-settings')")
    })
})
