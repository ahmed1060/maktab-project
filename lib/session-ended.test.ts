import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A session the server ends signs the browser out: a role edited with "apply
 * now" (ROLES_PLAN.md §4.4), or a check the server couldn't make
 * (lib/auth.ts). Its token was emptied and kept, and proxy.ts counted any
 * token as signed in: the session had nobody in it, the dashboard crashed
 * reading it, and the sign-in page sent the browser back into the dashboard,
 * so it couldn't sign in again until the token ran out (browser flows, the
 * sign-in page's part 2).
 */

const SECRET = "session-ended-test-secret-0123456789"
vi.stubEnv("NEXTAUTH_SECRET", SECRET)

const db = { users: {} as Record<string, any> }
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: async ({ where }: any) => db.users[where.id] ?? null },
        superAdmin: { findUnique: async () => null },
        systemSettings: { findUnique: async () => null },
    },
}))

const { authOptions } = await import("@/lib/auth")
const { CATALOGUE_VERSION } = await import("@/lib/permissions/catalogue")
const jwt = (token: any) => authOptions.callbacks!.jwt!({ token } as any) as Promise<any>
const session = (token: any) => authOptions.callbacks!.session!({
    session: { user: { name: "Rania Fahmy", email: "tl2@shots.test" }, expires: "2026-12-05T00:00:00.000Z" },
    token,
} as any) as Promise<any>

/** A token whose minute's check is due. */
const due = (token: Record<string, unknown> = {}) => ({ sub: "u1", role: "EMPLOYEE", sessionVersion: 0, checkedAt: 0, grants: "", catalogue: CATALOGUE_VERSION, ...token })
const ROW = { sessionVersion: 0, status: "ACTIVE", role: "EMPLOYEE", roleId: null, assignedRole: null, actingUntil: null, company: null, emailVerifiedAt: new Date(), mfaEnabled: false }

beforeEach(() => { db.users = {} })

describe("a session the server ends", () => {
    // As it was: the token is emptied at the session's next check.
    it("is emptied when the account's sessions were ended", async () => {
        db.users.u1 = { ...ROW, sessionVersion: 1 }
        expect((await jwt(due())).sub).toBeUndefined()
        db.users.u1 = { ...ROW }
        expect((await jwt(due())).sub).toBe("u1")
    })

    it("is no session at all: nobody is in it", async () => {
        expect(await session({})).toEqual({})
        // As the cookie holds it once it's been written back.
        expect(await session({ iat: 1, exp: 2, jti: "j" })).toEqual({})
        // Somebody's is as it was.
        expect((await session({ sub: "u1", role: "EMPLOYEE" })).user).toMatchObject({ id: "u1", role: "EMPLOYEE", name: "Rania Fahmy" })
    })
})

describe("proxy.ts", () => {
    /** Where a visit goes, with the session cookie holding this token, or none. */
    async function visit(path: string, token?: Record<string, unknown>) {
        const { default: proxy } = await import("@/proxy")
        const { encode } = await import("next-auth/jwt")
        const { NextRequest } = await import("next/server")
        const headers = new Headers()
        if (token) headers.set("cookie", `next-auth.session-token=${await encode({ token: token as never, secret: SECRET })}`)
        const res = await (proxy as any)(new NextRequest(new URL(path, "http://localhost:3000"), { headers }), {})
        return { to: res?.headers.get("location") ?? null, shows: res?.headers.get("x-middleware-rewrite") ?? null }
    }
    const signedIn = { sub: "u1", role: "EMPLOYEE", emailVerified: true }

    it("counts a token with somebody in it as signed in", async () => {
        expect((await visit("/login", signedIn)).to).toBe("http://localhost:3000/dashboard")
        expect((await visit("/", signedIn)).to).toBe("http://localhost:3000/dashboard")
        expect(await visit("/dashboard", signedIn)).toEqual({ to: null, shows: null })
    })

    it("counts an emptied token as signed out: the sign-in page shows, and the dashboard sends there", async () => {
        expect(await visit("/login", {})).toEqual({ to: null, shows: null })
        expect((await visit("/", {})).shows).toBe("http://localhost:3000/login")
        expect((await visit("/dashboard", {})).to).toMatch(/^http:\/\/localhost:3000\/api\/auth\/signin\?callbackUrl=/)
    })

    it("is as it was with no token", async () => {
        expect(await visit("/login")).toEqual({ to: null, shows: null })
        expect((await visit("/")).shows).toBe("http://localhost:3000/login")
        expect((await visit("/dashboard")).to).toMatch(/^http:\/\/localhost:3000\/api\/auth\/signin\?callbackUrl=/)
    })
})
