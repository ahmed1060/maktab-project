import { describe, it, expect, vi, beforeEach } from "vitest"
import bcrypt from "bcryptjs"

/**
 * Sign-in's limit of five tries in fifteen minutes, run through authorize()
 * against a mocked database. Found on production: a Super Admin with
 * two-factor signed in twice in a row, and the third sign-in was refused for
 * fifteen minutes, because every round trip counted — the password step that
 * only asks for the code, and every sign-in that succeeded. Behind one office
 * address, a whole company's morning logins shared those five.
 */

const db = {
    superAdmins: {} as Record<string, any>,
    users: {} as Record<string, any>,
    failLogin: false,
    limits: {} as Record<string, { count: number; resetAt: Date }>,
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        superAdmin: { findUnique: async ({ where }: any) => Object.values(db.superAdmins).find((a: any) => a.email === where.email) ?? null },
        user: {
            findUnique: async ({ where }: any) => Object.values(db.users).find((u: any) => u.email === where.email) ?? null,
            update: async () => ({}),
        },
        systemSettings: { findUnique: async () => null },
        rateLimit: {
            findUnique: async ({ where }: any) => db.limits[where.key] ?? null,
            upsert: async ({ where, create }: any) => (db.limits[where.key] = { count: create.count, resetAt: create.resetAt }),
            update: async ({ where }: any) => { db.limits[where.key].count++; return db.limits[where.key] },
            updateMany: async ({ where, data }: any) => {
                const row = db.limits[where.key]
                const sameWindow = !where.resetAt || row?.resetAt.getTime() === where.resetAt.getTime()
                if (row && sameWindow && row.count > (where.count?.gt ?? -Infinity)) { row.count -= data.count.decrement; return { count: 1 } }
                return { count: 0 }
            },
        },
    },
}))
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }))
// The authenticator itself: "123456" is right, anything else is not.
vi.mock("@/lib/services/mfa.service", () => ({
    MfaService: { verifyStoredCode: async (_secret: string, code: string) => code === "123456" },
}))
vi.mock("@/lib/services/trusted-device.service", () => ({ TrustedDeviceService: { isTrusted: async () => false } }))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: {
        log: async (action: string) => { if (action === "LOGIN" && db.failLogin) throw new Error("audit down") },
        logSystemError: async () => "ref", friendlyErrorMessage: () => "error",
    },
}))

const { authOptions } = await import("@/lib/auth")
const { RateLimiter } = await import("@/lib/api-utils")

const authorize = (credentials: Record<string, string>) =>
    (authOptions.providers[0] as any).options.authorize(credentials, {} as any)

const email = "sa@example.test"
const password = "the-right-password"

beforeEach(() => {
    db.limits = {}
    db.failLogin = false
    db.superAdmins = {
        sa: { id: "sa", email, password: bcrypt.hashSync(password, 4), firstName: "S", lastName: "A", mfaEnabled: true, mfaSecret: "stored", emailVerifiedAt: new Date() },
    }
    db.users = {
        held: {
            id: "held", email: "held@example.test", password: bcrypt.hashSync(password, 4), firstName: "H", lastName: "D",
            role: "EMPLOYEE", status: "SUSPENDED", companyId: "c1", company: { id: "c1", name: "One", isBanned: false, package: null, payments: [] },
        },
    }
})

describe("signing in, five tries in fifteen minutes", () => {
    it("counts neither the step that asks for the code nor a sign-in that succeeds", async () => {
        for (let i = 0; i < 4; i++) {
            await expect(authorize({ email, password })).rejects.toThrow("MFA_REQUIRED")
            expect(await authorize({ email, password, mfaCode: "123456" }), `sign-in ${i + 1}`).toMatchObject({ id: "sa" })
        }
    })

    it("still stops a sixth try after five wrong passwords", async () => {
        for (let i = 0; i < 5; i++) expect(await authorize({ email, password: "wrong" })).toBeNull()
        await expect(authorize({ email, password })).rejects.toThrow("Too many login attempts")
    })

    it("still stops a sixth try after five wrong codes", async () => {
        for (let i = 0; i < 5; i++) await expect(authorize({ email, password, mfaCode: "000000" })).rejects.toThrow("INVALID_MFA_CODE")
        await expect(authorize({ email, password, mfaCode: "123456" })).rejects.toThrow("Too many login attempts")
    })
})

describe("what gives an attempt back (review on #29)", () => {
    it("an account turned away after its password was right, so one put right in the window can sign in", async () => {
        // Suspended, banned, out of subscription, another company or closed:
        // none is a wrong guess, but each used one of the address's five.
        const held = { email: "held@example.test", password }
        for (let i = 0; i < 6; i++) await expect(authorize(held), `try ${i + 1}`).rejects.toThrow("Your account has been suspended or deleted.")
        db.users.held.status = "ACTIVE"
        expect(await authorize(held)).toMatchObject({ id: "held" })
    })

    it("only in the window it was counted in", async () => {
        // Counted in one window; by the time the attempt comes back a new
        // window has begun, with a wrong guess in it. That guess stays counted.
        const { resetAt } = await RateLimiter.getLimitData("login:198.51.100.1", 5, 15 * 60 * 1000)
        db.limits["login:198.51.100.1"] = { count: 1, resetAt: new Date(resetAt + 15 * 60 * 1000) }
        await RateLimiter.refund("login:198.51.100.1", resetAt)
        expect(db.limits["login:198.51.100.1"].count).toBe(1)
        // In its own window it is given back.
        const again = await RateLimiter.getLimitData("login:198.51.100.2", 5, 15 * 60 * 1000)
        await RateLimiter.refund("login:198.51.100.2", again.resetAt)
        expect(db.limits["login:198.51.100.2"].count).toBe(0)
    })

    it("once, even if something fails after a sign-in has given it back", async () => {
        // Guards the refund above: the success gives it back, then the audit
        // write fails, and the catch must not give back a second, which would
        // forget the wrong guess before it. (The old code refunded neither.)
        db.superAdmins.sa.mfaEnabled = false
        expect(await authorize({ email, password: "wrong" })).toBeNull()
        db.failLogin = true
        await expect(authorize({ email, password })).rejects.toThrow("audit down")
        expect(db.limits["login:203.0.113.7"].count).toBe(1)
    })
})
