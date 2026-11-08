import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { withGrants } from "./permissions/test-actors"

/**
 * Where a session the server ended goes (lib/session-ended.test.ts has why):
 * the pages send it to a route that clears its cookie, then on to sign in;
 * the routes refuse it; and a page left open signs itself out.
 */

const state = { session: null as any }
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const source = (path: string) => readFileSync(path, "utf8")
const somebody = () => ({ user: withGrants({ id: "u1", role: "ADMIN", companyId: "c1" }) })

describe("the route a page sends an ended session to", () => {
    const visit = async (cookies: string) => {
        const { GET } = await import("@/app/api/auth/ended/route")
        const { NextRequest } = await import("next/server")
        return GET(new NextRequest("https://nizmo.test/api/auth/ended", { headers: { cookie: cookies } }))
    }
    const COOKIES = "next-auth.session-token=a; next-auth.session-token.0=b; __Secure-next-auth.session-token=c; NEXT_LOCALE=ar; next-auth.csrf-token=d"

    it("clears its session cookie, every part of it, and goes on to sign in", async () => {
        state.session = null
        const res = await visit(COOKIES)
        expect(res.status).toBe(307)
        // Saying why there (lib/signed-out.test.ts).
        expect(res.headers.get("location")).toBe("https://nizmo.test/login?session=ended")
        for (const name of ["next-auth.session-token", "next-auth.session-token.0", "__Secure-next-auth.session-token"]) {
            expect(res.cookies.get(name), name).toMatchObject({ value: "", maxAge: 0, path: "/" })
        }
        // A __Secure- cookie is only cleared by one that's Secure too.
        expect(res.cookies.get("__Secure-next-auth.session-token")).toMatchObject({ secure: true })
        // Nothing else of the browser's is touched.
        expect(res.cookies.get("NEXT_LOCALE")).toBeUndefined()
        expect(res.cookies.get("next-auth.csrf-token")).toBeUndefined()
    })

    it("signs nobody out whose session is good: a link to it can't", async () => {
        state.session = somebody()
        const res = await visit(COOKIES)
        expect(res.headers.get("location")).toBe("https://nizmo.test/dashboard")
        expect(res.cookies.getAll()).toEqual([])
    })
})

describe("the routes", () => {
    it("refuse a session with nobody in it", async () => {
        const { withStandardHandler } = await import("@/lib/api-utils")
        const { ApiResponse } = await import("@/lib/api-response")
        const route = withStandardHandler(async () => ApiResponse.success({ ok: true }))
        const ask = async () => (await route(new Request("https://nizmo.test/api/anything"))).status
        state.session = { user: { name: "Rania Fahmy", email: "tl2@shots.test" } }
        expect(await ask()).toBe(401)
        state.session = null
        expect(await ask()).toBe(401)
        state.session = somebody()
        expect(await ask()).toBe(200)
    })
})

describe("the pages", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
    })
    const dashboard = files("app/(dashboard)")

    it("send a session that's gone to the route that clears it, never straight to sign in", () => {
        for (const file of dashboard) {
            expect(source(file), file).not.toMatch(/redirect\(\s*['"`]\/login/)
        }
        expect(source("app/(dashboard)/layout.tsx")).toMatch(/if \(!session\) \{\s*redirect\(SESSION_ENDED_PATH\)/)
        const sending = dashboard.filter(file => source(file).includes("redirect(SESSION_ENDED_PATH)"))
        expect(sending.sort()).toEqual([
            "app/(dashboard)/dashboard/costs/page.tsx",
            "app/(dashboard)/dashboard/records/[id]/page.tsx",
            "app/(dashboard)/dashboard/requests/page.tsx",
            "app/(dashboard)/dashboard/roles-and-access/page.tsx",
            "app/(dashboard)/layout.tsx",
        ])
        expect(source("lib/session-ended.ts")).toContain("export const SESSION_ENDED_PATH = '/api/auth/ended'")
    })

    // A request refused with a 401 signs the page out
    // (components/AuthInterceptor.tsx), as it did: the heartbeat's is refused
    // now, where a session with nobody in it reached the route as somebody's.
    // To sign in told why (lib/signed-out.test.ts).
    it("left open, sign themselves out once the server refuses the session", () => {
        expect(source("components/AuthInterceptor.tsx")).toMatch(/if \(res\.status === 401\) \{[^]*?if \(targetUrl && !targetUrl\.includes\('\/api\/auth\/'\)\) \{[^]*?signOut\(\{ callbackUrl: SESSION_ENDED_SIGN_IN \}\)/)
    })

    // Refused, the heartbeat read an answer it didn't have, and the console
    // said "Heartbeat failed: TypeError" as the page signed out (browser flows).
    it("say nothing of a heartbeat refused, which signs them out", () => {
        // Not reached at all, as when the page is left mid-request, it says nothing either (PR 217).
        expect(source("components/UserHeartbeat.tsx")).toMatch(/const res = await fetch\('\/api\/user\/activity', \{ method: 'POST' \}\)\.catch\(\(\) => null\)\s*(\/\/[^\n]*\n\s*)*if \(!res\?\.ok\) return\s*(\/\/[^\n]*\n\s*)*const data = \(await res\.json\(\)\.catch\(\(\) => null\)\)\?\.data/)
    })
})

// Signed in elsewhere with the old password, such as by someone who had
// learned it, the account stayed signed in after a reset (found at the
// sign-in page's part 2). Held back until an ended session signed its
// browser out: it would have stranded the person's own other browsers.
describe("a password reset", () => {
    it("ends the account's sessions wherever they are, a Super Admin's as well as anyone's", () => {
        const route = source("app/api/auth/forgot-password/confirm/route.ts")
        expect(route.match(/data: \{ password: hashed, mustChangePassword: false, emailVerifiedAt, sessionVersion: \{ increment: 1 \} \}/g)).toHaveLength(2)
    })
})
