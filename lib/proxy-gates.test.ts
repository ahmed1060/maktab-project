import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"

/**
 * The dashboard gates are four redirects in proxy.ts, each holding a user
 * on one page until a condition clears. Every one of them has the same failure
 * mode, and it is total: if the page a gate redirects *to* is not also the page
 * that gate lets *through*, the user bounces between the two until the browser
 * gives up. There is no error, no log, and no way out from inside the app.
 *
 * That is not a hypothetical risk here. Merging the email screen into Security
 * Settings moved the page a gate points at while leaving a redirect behind at
 * the old path, which is exactly the shape that produces the loop.
 *
 * Read as source rather than executed: proxy.ts throws at import without
 * NEXTAUTH_SECRET, and the thing worth pinning is the pairing, not the routing.
 */
const SOURCE = readFileSync("proxy.ts", "utf8")

// Each gate: the path it excludes from itself, and the path it sends people to.
const GATES = [
    { name: "forced password change", page: "/dashboard/change-password" },
    { name: "unverified email", page: "/dashboard/security-settings" },
    { name: "maintenance mode", page: "/dashboard/maintenance" },
    { name: "subscription lockout", page: "/dashboard/subscription-expired" },
]

/**
 * Each gate as a pair: the condition that decides it, and the page it sends
 * people to.
 *
 * Scoped to one gate rather than searched for across the file, because these
 * assertions used to be file-wide `toContain` and could not fail. The email
 * gate deliberately also excludes /dashboard/change-password, so that string
 * appears twice — which meant the forced-password-change gate could be deleted
 * outright and this suite stayed green. Found by deleting it.
 */
function gatesInSource(source: string): { condition: string; target: string }[] {
    const out: { condition: string; target: string }[] = []
    const REDIRECT = /return NextResponse\.redirect\(new URL\('([^']+)', req\.url\)\)/g

    for (const match of source.matchAll(REDIRECT)) {
        // The condition is the `if (...)` immediately above this redirect.
        const before = source.slice(0, match.index)
        const ifStart = before.lastIndexOf("if (")
        if (ifStart === -1) continue
        out.push({ condition: before.slice(ifStart), target: match[1] })
    }
    return out
}

describe("every gate lets through the page it redirects to", () => {
    const gates = gatesInSource(SOURCE)

    it("finds a gate for each redirect target", () => {
        // Vacuous otherwise: no gates parsed means every check below passes.
        expect(gates.length).toBeGreaterThanOrEqual(GATES.length)
    })

    it.each(GATES.map(g => [g.name, g.page]))("%s → %s", (_name, page) => {
        const gate = gates.find(g => g.target === page)
        expect(gate, `nothing redirects to ${page}`).toBeDefined()
        expect(
            gate!.condition,
            `the gate redirecting to ${page} does not exclude ${page} from itself, ` +
            `so anyone it catches bounces between the two forever`,
        ).toContain(`pathname !== '${page}'`)
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
