import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { withGrants } from "./permissions/test-actors"

/**
 * A client account's session, kept out of the company's app
 * (CLIENT_PORTAL_PLAN.md §5.3, §12 step 7a; PR 331): told apart from a
 * person's and a Super Admin's, sent from the company's pages to the
 * client's area, refused by every route but the area's own, and logged as
 * no one of the company's. No sign-in makes such a session yet, so these
 * tests make one by hand.
 */

const state = { session: null as any, logged: [] as any[], audits: [] as any[] }
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { create: async (a: any) => { state.audits.push(a.data); return {} } } } }))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: {
        logSystemError: async (a: any) => { state.logged.push(a); return "REF1" },
        friendlyErrorMessage: (ref: string) => `Something went wrong (${ref}).`,
    },
}))

const CLIENT = { id: "acct-1", role: "CLIENT_ACCOUNT", clientId: "client-1", companyId: "c1" }
const PERSON = withGrants({ id: "u1", role: "ADMIN", companyId: "c1" })
const SUPER = { id: "sa1", role: "SUPER_ADMIN" }

describe("telling a client account's session apart", () => {
    it("by its kind, which no person or Super Admin has", async () => {
        const { CLIENT_ACCOUNT_ROLE, isClientAccount } = await import("./client-session")
        expect(CLIENT_ACCOUNT_ROLE).toBe("CLIENT_ACCOUNT")
        expect(isClientAccount(CLIENT)).toBe(true)
        for (const who of [PERSON, SUPER, { role: "EMPLOYEE" }, { role: "TEAM_LEADER" }, {}, null, undefined]) expect(isClientAccount(who as any)).toBe(false)
        // Not a role a company's person can be given.
        const { BUILT_IN_GRANTS } = await import("./permissions/built-in")
        expect(Object.keys(BUILT_IN_GRANTS)).not.toContain(CLIENT_ACCOUNT_ROLE)
    })

    it("the client's area is at /portal, its routes under /api/portal", async () => {
        const { CLIENT_AREA, inClientArea, inClientAreaApi } = await import("./client-session")
        expect(CLIENT_AREA).toBe("/portal")
        for (const p of ["/portal", "/portal/", "/portal/statement"]) expect(inClientArea(p), p).toBe(true)
        for (const p of ["/portals", "/dashboard/portal", "/", "/login", "/api/portal"]) expect(inClientArea(p), p).toBe(false)
        for (const p of ["/api/portal", "/api/portal/tax-position"]) expect(inClientAreaApi(p), p).toBe(true)
        for (const p of ["/api/portals", "/api/clients", "/portal"]) expect(inClientAreaApi(p), p).toBe(false)
    })
})

describe("where the proxy sends a signed-in browser", () => {
    it("a client account: from the company's pages, the sign-in page and the root, to the client's area", async () => {
        const { proxyRedirect } = await import("./client-session")
        const token = { sub: "acct-1", role: "CLIENT_ACCOUNT" }
        for (const p of ["/", "/login", "/dashboard", "/dashboard/clients/x", "/dashboard/change-password"]) expect(proxyRedirect(token, p), p).toBe("/portal")
        for (const p of ["/portal", "/portal/statement"]) expect(proxyRedirect(token, p), p).toBeNull()
        // Pages open to anyone stay open: the legal pages, and the invitation's.
        for (const p of ["/privacy", "/terms", "/invitation"]) expect(proxyRedirect(token, p), p).toBeNull()
    })

    it("one of the company's people or a Super Admin: from the client's area to the dashboard", async () => {
        const { proxyRedirect } = await import("./client-session")
        for (const token of [{ sub: "u1", role: "ADMIN" }, { sub: "sa1", role: "SUPER_ADMIN" }]) {
            for (const p of ["/portal", "/portal/statement"]) expect(proxyRedirect(token, p), p).toBe("/dashboard")
            for (const p of ["/dashboard", "/dashboard/clients", "/privacy"]) expect(proxyRedirect(token, p), p).toBeNull()
        }
    })

    it("no one signed in, or a session the server ended: nothing here, as before", async () => {
        const { proxyRedirect } = await import("./client-session")
        for (const token of [null, undefined, {}, { role: "CLIENT_ACCOUNT" }]) {
            for (const p of ["/", "/login", "/dashboard", "/portal"]) expect(proxyRedirect(token as any, p), p).toBeNull()
        }
    })

    it("proxy.ts asks it first, and asks for a session in the client's area as in the dashboard", () => {
        const proxy = readFileSync("proxy.ts", "utf8")
        const asked = proxy.indexOf("proxyRedirect(token, pathname)")
        expect(asked).toBeGreaterThan(-1)
        // Before anything that sends a browser to /dashboard or holds it on a page there.
        for (const later of ["new URL('/dashboard', req.url)", "/dashboard/change-password', req.url", "/dashboard/security-settings', req.url"]) {
            expect(proxy.indexOf(later), later).toBeGreaterThan(asked)
        }
        expect(proxy).toContain("if (inClientArea(pathname)) return !!token?.sub")
    })
})

describe("the routes", () => {
    it("refuse a client account's session, and nothing runs", async () => {
        const { withStandardHandler } = await import("@/lib/api-utils")
        state.session = { user: CLIENT }
        let ran = false
        const route = withStandardHandler(async () => { ran = true; return new Response("{}") as any })
        const res = await route(new Request("https://nizmo.test/api/clients"))
        expect(res.status).toBe(403)
        expect(ran).toBe(false)
    })

    it("even one that asks for no permission, such as the heartbeat", async () => {
        const { withStandardHandler } = await import("@/lib/api-utils")
        state.session = { user: CLIENT }
        let ran = false
        const route = withStandardHandler(async () => { ran = true; return new Response("{}") as any })
        const res = await route(new Request("https://nizmo.test/api/user/activity", { method: "POST" }))
        expect(res.status).toBe(403)
        expect(ran).toBe(false)
    })

    it("the area's own routes take a client account, and refuse the company's people and Super Admins", async () => {
        const { withStandardHandler } = await import("@/lib/api-utils")
        const { NextResponse } = await import("next/server")
        const route = withStandardHandler(async (_req, session) => NextResponse.json({ who: session.user.id }), { clientArea: true })
        state.session = { user: CLIENT }
        const ok = await route(new Request("https://nizmo.test/api/portal/tax-position"))
        expect(ok.status).toBe(200)
        expect(await ok.json()).toEqual({ who: "acct-1" })
        for (const user of [PERSON, SUPER]) {
            state.session = { user }
            const res = await route(new Request("https://nizmo.test/api/portal/tax-position"))
            expect(res.status, user.role).toBe(403)
        }
    })

    it("an error in a route a client account reached names no one of the company's or Super Admin", async () => {
        const { withStandardHandler } = await import("@/lib/api-utils")
        state.session = { user: CLIENT }
        state.logged = []
        const route = withStandardHandler(async () => { throw new Error("boom") }, { clientArea: true })
        const res = await route(new Request("https://nizmo.test/api/portal/tax-position"))
        expect(res.status).toBe(500)
        expect(state.logged).toHaveLength(1)
        expect(state.logged[0]).toMatchObject({ userId: null, superAdminId: null })
    })

    it("and one of the company's people's is named as before", async () => {
        const { withStandardHandler } = await import("@/lib/api-utils")
        state.session = { user: PERSON }
        state.logged = []
        const route = withStandardHandler(async () => { throw new Error("boom") })
        await route(new Request("https://nizmo.test/api/clients"))
        expect(state.logged[0]).toMatchObject({ userId: "u1", superAdminId: null })
        state.session = { user: SUPER }
        state.logged = []
        await route(new Request("https://nizmo.test/api/clients"))
        expect(state.logged[0]).toMatchObject({ userId: null, superAdminId: "sa1" })
    })

    it("who an entry names, for each kind of account", async () => {
        const { loggedAs } = await import("./client-session")
        expect(loggedAs({ id: "u1", role: "EMPLOYEE" })).toEqual({ userId: "u1", superAdminId: null })
        expect(loggedAs({ id: "sa1", role: "SUPER_ADMIN" })).toEqual({ userId: null, superAdminId: "sa1" })
        // A Super Admin previewing a role is still the Super Admin.
        expect(loggedAs({ id: "sa1", role: "ADMIN", preview: { roleId: "r" } })).toEqual({ userId: null, superAdminId: "sa1" })
        expect(loggedAs({ id: "acct-1", role: "CLIENT_ACCOUNT" })).toEqual({ userId: null, superAdminId: null })
        expect(loggedAs(null)).toEqual({ userId: null, superAdminId: null })
    })
})

const routes = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? routes(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : [])

/**
 * The routes that read a session without withStandardHandler, and what each
 * takes instead. Each takes a Super Admin alone, or a cron's secret, by
 * comparing the session's kind; the two that don't are said here.
 */
const ELSEWHERE: Record<string, string> = {
    "app/api/auth/ended/route.ts": "sends any session that's still good to the dashboard, and the proxy sends a client account's on to the client's area; it reveals nothing",
    "app/api/system/log-client-error/route.ts": "takes an error report from anyone, signed in or not, and names whoever sent it by loggedAs",
}

describe("every route", () => {
    const all = routes("app/api")

    it("there are routes to hold to this", () => {
        expect(all.length).toBeGreaterThan(200)
    })

    it("goes through withStandardHandler, or reads no session, or takes a Super Admin alone, or is said above", () => {
        const wrong: string[] = []
        for (const f of all) {
            const src = readFileSync(f, "utf8")
            if (src.includes("withStandardHandler")) continue
            if (!src.includes("getServerSession")) continue
            if (ELSEWHERE[f]) continue
            if (/role\s*(===|!==)\s*['"]SUPER_ADMIN['"]/.test(src)) continue
            wrong.push(f)
        }
        expect(wrong).toEqual([])
    })

    it("only the area's own routes take a client account, and every one of them does", () => {
        const wrong: string[] = []
        for (const f of all) {
            const src = readFileSync(f, "utf8")
            const takes = /clientArea:\s*true/.test(src)
            const inArea = f.startsWith("app/api/portal/")
            if (takes !== inArea) wrong.push(f)
            if (inArea && !src.includes("withStandardHandler")) wrong.push(f)
        }
        expect(wrong).toEqual([])
    })

    it("the routes said above are still there, and still don't go through withStandardHandler", () => {
        for (const f of Object.keys(ELSEWHERE)) {
            const src = readFileSync(f, "utf8")
            expect(src, f).toContain("getServerSession")
            expect(src, f).not.toContain("withStandardHandler")
        }
        expect(readFileSync("app/api/system/log-client-error/route.ts", "utf8")).toContain("loggedAs(")
    })

    it("the handler's audit entries name the account by loggedAs too", () => {
        const src = readFileSync("lib/api-utils.ts", "utf8")
        expect(src).not.toMatch(/kind\s*[!=]==\s*'SUPER_ADMIN'\s*\?\s*userId/)
        expect(src).toContain("named = loggedAs(session.user as any)")
        expect(src.match(/\.\.\.named,/g)?.length).toBe(2)
    })
})
