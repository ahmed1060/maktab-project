import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The session token's jwt() and session() callbacks, run for real against a
 * mocked database: what a client may and may not change about its own
 * session.
 */

const db = {
    roles: {} as Record<string, any>,
    users: {} as Record<string, any>,
    superAdmins: {} as Record<string, any>,
    audit: [] as string[],
    limits: {} as Record<string, { count: number; resetAt: Date }>,
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        role: { findUnique: async ({ where }: any) => db.roles[where.id] ?? null },
        user: { findUnique: async ({ where }: any) => db.users[where.id] ?? null },
        superAdmin: { findUnique: async ({ where }: any) => db.superAdmins[where.id] ?? null },
        systemSettings: { findUnique: async () => null },
        rateLimit: {
            findUnique: async ({ where }: any) => db.limits[where.key] ?? null,
            upsert: async ({ where, create }: any) => (db.limits[where.key] = { count: create.count, resetAt: create.resetAt }),
            update: async ({ where }: any) => { db.limits[where.key].count++; return db.limits[where.key] },
        },
    },
}))
// The authenticator itself: "123456" is right, anything else is not.
vi.mock("@/lib/services/mfa.service", () => ({
    MfaService: { verifyStoredCode: async (_secret: string, code: string) => code === "123456" },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async (action: string) => { db.audit.push(action) }, logSystemError: async () => "ref" },
}))

const { authOptions } = await import("@/lib/auth")
const jwt = (args: any) => authOptions.callbacks!.jwt!(args) as Promise<any>
const session = (token: any) => authOptions.callbacks!.session!({ session: { user: {} } as any, token } as any) as Promise<any>

// A token as the minute's check left it: nothing re-read on this call.
const fresh = (token: Record<string, unknown>) => ({ checkedAt: Date.now(), sessionVersion: 0, grants: "", ...token })

beforeEach(() => {
    db.audit = []
    db.roles = {
        r1: { id: "r1", name: "HR Officer", baseRole: "EMPLOYEE", companyId: "c1", company: { name: "One", package: null }, grants: [{ permission: "dayoff.approve", scope: "COMPANY" }] },
    }
    db.users = {}
    db.superAdmins = {}
    db.limits = {}
})

describe("previewing a role (ROLES_PLAN.md §6.6)", () => {
    it("starts for a Super Admin, and the session presents the role", async () => {
        const token = await jwt({ token: fresh({ sub: "sa", role: "SUPER_ADMIN" }), trigger: "update", session: { previewRoleId: "r1" } })
        expect(token.preview).toMatchObject({ roleId: "r1", companyId: "c1", baseRole: "EMPLOYEE" })
        expect(token.role).toBe("SUPER_ADMIN") // the real identity stays
        expect(db.audit).toEqual(["START_ROLE_PREVIEW"])

        const s = await session(token)
        expect(s.user).toMatchObject({ role: "EMPLOYEE", companyId: "c1", companyName: "One", preview: { roleName: "HR Officer" } })
        expect(s.user.grants).toBe(token.preview.grants)
    })

    it("cannot be started by anybody else, whatever they send", async () => {
        const token = await jwt({ token: fresh({ sub: "u1", role: "ADMIN", companyId: "c1" }), trigger: "update", session: { previewRoleId: "r1" } })
        expect(token.preview).toBeUndefined()
        expect((await session(token)).user.preview).toBeNull()
        expect(db.audit).toEqual([])
    })

    it("ends when asked, and by itself after an hour", async () => {
        const started = await jwt({ token: fresh({ sub: "sa", role: "SUPER_ADMIN" }), trigger: "update", session: { previewRoleId: "r1" } })
        const ended = await jwt({ token: started, trigger: "update", session: { previewRoleId: null } })
        expect(ended.preview).toBeNull()
        expect(db.audit).toEqual(["START_ROLE_PREVIEW", "END_ROLE_PREVIEW"])

        const old = { ...started, preview: { ...started.preview, startedAt: Date.now() - 61 * 60 * 1000 } }
        expect((await jwt({ token: old })).preview).toBeNull()
    })
})

/**
 * update() is the browser's to call, with whatever it likes. The flags the
 * dashboard is gated on (proxy.ts) come from the database, never from it.
 */
describe("a client updating its own session", () => {
    const row = (overrides: Record<string, unknown> = {}) => ({ email: "e1@x.co", emailVerifiedAt: null, mfaEnabled: false, mustChangePassword: true, ...overrides })

    it("cannot claim a verified email or a finished password reset the database disagrees with", async () => {
        db.users.e1 = row()
        const token = await jwt({
            token: fresh({ sub: "e1", role: "EMPLOYEE", emailVerified: false, mustChangePassword: true, mfaEnabled: false }),
            trigger: "update",
            session: { emailVerified: true, mustChangePassword: false, mfaEnabled: true, email: "someone-else@x.co" },
        })
        expect(token).toMatchObject({ emailVerified: false, mustChangePassword: true, mfaEnabled: false, email: "e1@x.co" })
    })

    it("gets the new values once the server has changed the row", async () => {
        db.users.e1 = row({ emailVerifiedAt: new Date(), mustChangePassword: false, mfaEnabled: true, email: "new@x.co" })
        const token = await jwt({
            token: fresh({ sub: "e1", role: "EMPLOYEE", emailVerified: false, mustChangePassword: true, mfaEnabled: false }),
            trigger: "update",
            session: { emailVerified: true, mustChangePassword: false },
        })
        expect(token).toMatchObject({ emailVerified: true, mustChangePassword: false, mfaEnabled: true, email: "new@x.co" })
    })

    it("reads a Super Admin's own row", async () => {
        db.superAdmins.sa = row({ email: "sa@x.co", emailVerifiedAt: null })
        const token = await jwt({ token: fresh({ sub: "sa", role: "SUPER_ADMIN", emailVerified: false }), trigger: "update", session: { emailVerified: true } })
        expect(token.emailVerified).toBe(false)
    })

    it("still takes what is only shown: names, picture, language", async () => {
        const token = await jwt({ token: fresh({ sub: "e1", role: "EMPLOYEE" }), trigger: "update", session: { firstName: "Nour", language: "ar", avatar: "a.png" } })
        expect(token).toMatchObject({ firstName: "Nour", language: "ar", avatar: "a.png" })
    })
})

/**
 * Step-up (ROLES_PLAN.md §6.15): the code is checked by the server against the
 * account's own secret, and only a right code writes the time into the token.
 */
describe("confirming a high-risk action with a code", () => {
    const withMfa = { email: "a@x.co", emailVerifiedAt: new Date(), mfaEnabled: true, mfaSecret: "sealed", mustChangePassword: false }
    const ask = (code: string, token: Record<string, unknown> = {}) =>
        jwt({ token: fresh({ sub: "a1", role: "ADMIN", companyId: "c1", ...token }), trigger: "update", session: { stepUpCode: code } })

    it("a right code records when, in the token and the session", async () => {
        db.users.a1 = withMfa
        const before = Date.now()
        const token = await ask("123456")
        expect(token.stepUpAt).toBeGreaterThanOrEqual(before)
        expect((await session(token)).user.stepUpAt).toBe(token.stepUpAt)
    })

    it("a wrong code, or no two-factor set up, records nothing", async () => {
        db.users.a1 = withMfa
        expect((await ask("000000")).stepUpAt).toBeUndefined()
        db.users.a1 = { ...withMfa, mfaEnabled: false }
        expect((await ask("123456")).stepUpAt).toBeUndefined()
    })

    it("the browser cannot write the time itself", async () => {
        db.users.a1 = withMfa
        const token = await jwt({ token: fresh({ sub: "a1", role: "ADMIN" }), trigger: "update", session: { stepUpAt: Date.now() } })
        expect(token.stepUpAt).toBeUndefined()
    })

    it("stops checking codes after five tries in fifteen minutes, even a right one", async () => {
        db.users.a1 = withMfa
        for (let i = 0; i < 5; i++) await ask("000000")
        expect((await ask("123456")).stepUpAt).toBeUndefined()
    })
})
