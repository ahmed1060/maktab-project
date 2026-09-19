import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * /privacy and /terms are the only two pages in this app that a stranger has to
 * be able to load, and the only two whose reachability something outside the
 * app depends on: Google fetches the privacy URL, signed out, before it will
 * let the OAuth consent screen leave Testing status. A consent screen stuck in
 * Testing issues refresh tokens that expire after seven days, which is what
 * silently killed the nightly backup for a week in September 2026.
 *
 * So the chain is: these pages public → consent screen publishable → the backup
 * token stops expiring → the backup runs. Nothing in the type system or the
 * build says so, and the failure is invisible from inside the product — the
 * pages keep working for anyone signed in. These assertions are the only place
 * that chain is written down as something a change can break.
 *
 * Source text rather than a request, because there is no server in a unit test
 * and middleware.ts throws at import without NEXTAUTH_SECRET. Comments are
 * stripped first: this file's own explanations mention the paths it checks for,
 * and so do the comments in the files it reads.
 */
const LEGAL_PAGES = [
    { path: "/privacy", file: "app/(legal)/privacy/page.tsx" },
    { path: "/terms", file: "app/(legal)/terms/page.tsx" },
]

describe("the legal pages exist and sit outside every auth boundary", () => {
    it.each(LEGAL_PAGES.map(p => [p.path, p.file]))("%s is served by %s", (_path, file) => {
        expect(existsSync(file), `${file} is missing`).toBe(true)
    })

    it("does not gate them in middleware", () => {
        const source = stripComments(readFileSync("proxy.ts", "utf8"))

        // Isolate the authorized callback before asserting anything about it.
        // Searching the whole file for the dashboard check passes even when the
        // callback has been widened to gate everything, because the same
        // expression appears in all four of the redirect gates below it — a
        // guard that matches the wrong occurrence is worse than no guard, since
        // it reports green for the thing it was written to catch.
        const start = source.indexOf("authorized:")
        const end = source.indexOf("secret:", start)
        expect(start, "proxy.ts has no authorized callback").toBeGreaterThan(-1)
        expect(end, "the callbacks block no longer ends at secret:").toBeGreaterThan(start)
        const authorized = source.slice(start, end)

        // It must require a token for /dashboard and nothing wider: widen it
        // and Google's fetch gets a redirect to /login, which reads to it as
        // "no privacy policy".
        expect(
            authorized,
            "the authorized callback no longer scopes its token requirement to /dashboard",
        ).toContain("pathname.startsWith('/dashboard')")
        expect(
            authorized,
            "the authorized callback no longer lets non-dashboard paths through",
        ).toContain("return true")

        // And nothing anywhere in the middleware may single these paths out.
        for (const { path } of LEGAL_PAGES) {
            expect(
                source,
                `middleware now redirects or gates ${path}`,
            ).not.toContain(path)
        }
    })

    it("renders them without a session", () => {
        // A page that reads the session is a page that can redirect or throw for
        // a signed-out visitor, whatever the middleware allows.
        for (const { file, path } of LEGAL_PAGES) {
            const source = stripComments(readFileSync(file, "utf8"))
            expect(source, `${path} reads the session`).not.toMatch(/getServerSession|useSession/)
            expect(source, `${path} redirects`).not.toMatch(/\bredirect\(/)
        }
    })
})

describe("the app links to them", () => {
    // A policy reachable only from Google's console satisfies Google and nobody
    // else. These are the two places a person passes through: the page every
    // user signs in on, and the shell every signed-in page renders inside.
    const LINK_SITES = [
        { name: "the login page", file: "app/(auth)/login/page.tsx" },
        { name: "the dashboard shell", file: "components/DashboardShell.tsx" },
    ]

    it.each(LINK_SITES.map(s => [s.name, s.file]))("%s links to both", (_name, file) => {
        const source = stripComments(readFileSync(file, "utf8"))
        for (const { path } of LEGAL_PAGES) {
            expect(source, `${file} has no link to ${path}`).toContain(`href="${path}"`)
        }
    })
})

describe("the documents say what the system actually does", () => {
    const privacy = readFileSync("app/(legal)/privacy/page.tsx", "utf8")

    it("names every third party the code sends data to", () => {
        // Each of these is a real outbound dependency, and a privacy policy that
        // omits one is wrong rather than merely incomplete. Vercel Analytics is
        // the easiest to forget: it is one import in app/layout.tsx and collects
        // page views from every visitor.
        for (const party of ["Supabase", "Vercel", "Google Drive", "HERE", "Gmail"]) {
            expect(privacy, `the policy does not mention ${party}`).toContain(party)
        }
    })

    it("states the retention windows the workflows actually enforce", () => {
        // These four numbers are --min-age values in the backup and restore
        // workflows. If someone changes a retention window, the policy becomes a
        // written promise the system is not keeping, and this fails.
        const backup = readFileSync(".github/workflows/backup.yml", "utf8")
        const restore = readFileSync(".github/workflows/restore.yml", "utf8")

        const windows: Array<[string, string]> = [
            ["7d", "gdrive:daily"],
            ["28d", "gdrive:weekly"],
            ["365d", "gdrive:monthly"],
        ]
        for (const [age, folder] of windows) {
            // The workflow pads these into a column, so match on the pair
            // rather than on one exact spelling of the whitespace between them.
            const prune = new RegExp(`${folder}\\s+--min-age\\s+${age}\\b`)
            expect(prune.test(backup), `${folder} no longer prunes at ${age}`).toBe(true)
            expect(privacy, `the policy does not state the ${age} window`).toContain(
                `<strong>${age.replace("d", "")} day`,
            )
        }
        expect(restore, "pre-restore snapshots no longer prune at 30d").toContain("--min-age 30d")
        expect(privacy, "the policy does not state the 30 day window").toContain("<strong>30 days</strong>")
    })

    it("does not print the location radius", () => {
        // The verification distance is a business setting, not something to
        // publish. The policy describes the mechanism and says an administrator
        // sets the threshold, without naming it.
        expect(privacy).toContain("threshold their")
        expect(privacy).not.toMatch(/\d+\s*met(re|er)s/)
    })
})
