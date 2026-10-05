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
    limits: {} as Record<string, { count: number; resetAt: Date }>,
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        superAdmin: { findUnique: async ({ where }: any) => Object.values(db.superAdmins).find((a: any) => a.email === where.email) ?? null },
        user: { findUnique: async () => null },
        systemSettings: { findUnique: async () => null },
        rateLimit: {
            findUnique: async ({ where }: any) => db.limits[where.key] ?? null,
            upsert: async ({ where, create }: any) => (db.limits[where.key] = { count: create.count, resetAt: create.resetAt }),
            update: async ({ where }: any) => { db.limits[where.key].count++; return db.limits[where.key] },
            updateMany: async ({ where, data }: any) => {
                const row = db.limits[where.key]
                if (row && row.count > (where.count?.gt ?? -Infinity)) { row.count -= data.count.decrement; return { count: 1 } }
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
    AuditLogService: { log: async () => {}, logSystemError: async () => "ref" },
}))

const { authOptions } = await import("@/lib/auth")
const authorize = (credentials: Record<string, string>) =>
    (authOptions.providers[0] as any).options.authorize(credentials, {} as any)

const email = "sa@example.test"
const password = "the-right-password"

beforeEach(() => {
    db.limits = {}
    db.superAdmins = {
        sa: { id: "sa", email, password: bcrypt.hashSync(password, 4), firstName: "S", lastName: "A", mfaEnabled: true, mfaSecret: "stored" },
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
