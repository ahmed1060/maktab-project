import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * PUT /api/users, where a password is set on the profile or the Change
 * password page (lib/password-ends-sessions.test.ts has why): it ends the
 * account's other sessions, and keeps the one asking when the password is
 * its own. Which one that is, the route reads from the session's cookie.
 * These drive the real route and UserService; the database is a stand-in
 * holding two Super Admins.
 */

const SECRET = "password-ends-sessions-route-secret-01"
vi.stubEnv("NEXTAUTH_SECRET", SECRET)

const session = { value: null as any }
const written: Record<string, unknown>[] = []
const ACCOUNT = { firstName: "S", lastName: "A", gender: "FEMALE", avatar: null, isProtected: false, mustChangePassword: false, sessionVersion: 4, keptSession: null }
const ACCOUNTS: Record<string, any> = {
    sara: { ...ACCOUNT, id: "sara", email: "sara@nizmo.test", username: "sara" },
    sami: { ...ACCOUNT, id: "sami", email: "sami@nizmo.test", username: "sami" },
}

vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/system-settings.service", () => ({ SystemSettingsService: { get: async () => ({ stepUpMinutes: 15 }) } }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: async () => null },
        superAdmin: {
            findUnique: async ({ where }: any) => ACCOUNTS[where.id] ?? null,
            // As Prisma answers: only what was asked for.
            update: async ({ where, data, select }: any) => {
                written.push(data)
                const row = { ...ACCOUNTS[where.id], ...data }
                return select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : row
            },
        },
        rateLimit: { upsert: async () => ({ count: 1 }) },
    },
}))

/** A save from the browser whose session is named "mine", at the account's version. */
async function put(body: Record<string, unknown>, cookie: Record<string, unknown> | null = { sub: "sara", role: "SUPER_ADMIN", sid: "mine", sessionVersion: 4 }) {
    const { NextRequest } = await import("next/server")
    const { encode } = await import("next-auth/jwt")
    const headers = new Headers({ "Content-Type": "application/json" })
    if (cookie) headers.set("cookie", `next-auth.session-token=${await encode({ token: cookie as never, secret: SECRET })}`)
    const { PUT } = await import("@/app/api/users/route")
    return PUT(new NextRequest("https://nizmo.test/api/users", { method: "PUT", headers, body: JSON.stringify(body) }))
}
const sara = { user: { id: "sara", role: "SUPER_ADMIN", companyId: null, mfaEnabled: true, stepUpAt: Date.now() } }

describe("a new password, set on the profile or the Change password page", () => {
    beforeEach(() => { written.length = 0; session.value = sara })

    it("of one's own ends the account's other sessions, and keeps the one it was set from", async () => {
        expect((await put({ id: "sara", password: "a-new-password-123" })).status).toBe(200)
        expect(written).toHaveLength(1)
        expect(written[0]).toMatchObject({ mustChangePassword: false, sessionVersion: { increment: 1 }, keptSession: "5:mine" })
    })

    it("of one's own, from a session the account has already ended, keeps none", async () => {
        expect((await put({ id: "sara", password: "a-new-password-123" }, { sub: "sara", role: "SUPER_ADMIN", sid: "mine", sessionVersion: 3 })).status).toBe(200)
        expect(written[0]).toMatchObject({ sessionVersion: { increment: 1 } })
        expect(written[0]).not.toHaveProperty("keptSession")
    })

    it("of somebody else's ends all of theirs", async () => {
        expect((await put({ id: "sami", password: "a-new-password-123" })).status).toBe(200)
        expect(written[0]).toMatchObject({ sessionVersion: { increment: 1 } })
        expect(written[0]).not.toHaveProperty("keptSession")
    })

    it("isn't in a save without one, which ends nothing", async () => {
        expect((await put({ id: "sara", firstName: "Sara" })).status).toBe(200)
        expect(written).toEqual([{ firstName: "Sara" }])
    })

    it("says nothing of its sessions in the answer", async () => {
        const body = await (await put({ id: "sara", password: "a-new-password-123" })).json()
        expect(body.data).not.toHaveProperty("sessionVersion")
        expect(body.data).not.toHaveProperty("keptSession")
    })
})
