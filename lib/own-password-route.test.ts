import { describe, it, expect, vi, beforeEach } from "vitest"
import bcrypt from "bcryptjs"

/**
 * One's own current password, checked by the server (lib/own-password.db.
 * test.ts has why): what PUT /api/users and POST /api/auth/verify answer.
 * These drive the real routes and UserService; the database is a stand-in
 * holding two Super Admins, and its count of wrong tries is set by each test.
 */

const SECRET = "own-password-route-secret-0123456789"
vi.stubEnv("NEXTAUTH_SECRET", SECRET)

const CURRENT = "the-current-password"
const session = { value: null as any }
const written: Record<string, unknown>[] = []
/** The account's wrong tries so far in this window, as the rate limit table holds them. */
const tries = { count: 0 }
const ACCOUNT = { firstName: "S", lastName: "A", gender: "FEMALE", avatar: null, isProtected: false, mustChangePassword: false, sessionVersion: 4, keptSession: null, password: bcrypt.hashSync(CURRENT, 4) }
const ACCOUNTS: Record<string, any> = {}

vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/system-settings.service", () => ({ SystemSettingsService: { get: async () => ({ stepUpMinutes: 15 }) } }))
vi.mock("@/lib/prisma", () => {
    const prisma: any = {
        user: { findUnique: async () => null },
        $queryRaw: async (_sql: TemplateStringsArray, id: string) => [{ sessionVersion: ACCOUNTS[id].sessionVersion, keptSession: ACCOUNTS[id].keptSession }],
        $transaction: async (write: (tx: unknown) => unknown) => write(prisma),
        superAdmin: {
            findUnique: async ({ where }: any) => ACCOUNTS[where.id] ?? null,
            update: async ({ data, select }: any) => {
                written.push(data)
                return Object.fromEntries(Object.keys(select).map(k => [k, ACCOUNTS.sara[k]]))
            },
        },
        // A window already open: each try adds one, a right one gives it back.
        rateLimit: {
            findUnique: async () => ({ key: "k", count: tries.count, resetAt: new Date(Date.now() + 60_000) }),
            upsert: async () => ({ count: ++tries.count }),
            update: async () => ({ count: ++tries.count, resetAt: new Date(Date.now() + 60_000) }),
            updateMany: async () => { tries.count--; return { count: 1 } },
        },
    }
    return { prisma }
})

const cookieOf = async (token: Record<string, unknown>) => {
    const { encode } = await import("next-auth/jwt")
    return `next-auth.session-token=${await encode({ token: token as never, secret: SECRET })}`
}
const mine = { sub: "sara", role: "SUPER_ADMIN", sid: "mine", sessionVersion: 4 }

async function put(body: Record<string, unknown>, cookie: Record<string, unknown> = mine) {
    const { NextRequest } = await import("next/server")
    const { PUT } = await import("@/app/api/users/route")
    const headers = new Headers({ "Content-Type": "application/json", cookie: await cookieOf(cookie) })
    return PUT(new NextRequest("https://nizmo.test/api/users", { method: "PUT", headers, body: JSON.stringify(body) }))
}
async function verify(password: string) {
    const { NextRequest } = await import("next/server")
    const { POST } = await import("@/app/api/auth/verify/route")
    return POST(new NextRequest("https://nizmo.test/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }))
}
const sara = { user: { id: "sara", role: "SUPER_ADMIN", companyId: null, mfaEnabled: true, stepUpAt: Date.now() } }

beforeEach(() => {
    written.length = 0
    tries.count = 0
    session.value = sara
    ACCOUNTS.sara = { ...ACCOUNT, id: "sara", email: "sara@nizmo.test", username: "sara" }
    ACCOUNTS.sami = { ...ACCOUNT, id: "sami", email: "sami@nizmo.test", username: "sami" }
})

describe("a new password of one's own, on PUT /api/users", () => {
    it("is saved with the current one", async () => {
        expect((await put({ id: "sara", password: "a-new-password-123", currentPassword: CURRENT })).status).toBe(200)
        expect(written).toHaveLength(1)
        expect(tries.count).toBe(0)
    })

    it("is refused without it, or with a wrong one, by its code, and nothing is written", async () => {
        for (const body of [{ id: "sara", password: "a-new-password-123" }, { id: "sara", password: "a-new-password-123", currentPassword: "not-it-at-all" }]) {
            const res = await put(body)
            expect(res.status).toBe(403)
            expect(await res.json()).toMatchObject({ success: false, code: "CURRENT_PASSWORD_WRONG", error: "Your current password is needed to set a new one, and that isn't it" })
        }
        expect(written).toEqual([])
        // Only the wrong one was a guess.
        expect(tries.count).toBe(1)
    })

    it("is refused after five wrong tries, even with the right one, by its code", async () => {
        tries.count = 5
        const res = await put({ id: "sara", password: "a-new-password-123", currentPassword: CURRENT })
        expect(res.status).toBe(429)
        expect(await res.json()).toMatchObject({ success: false, code: "OWN_PASSWORD_TRIES", error: "Too many wrong tries for this account. You can try again within 15 minutes, or your company's Admin can unlock it now." })
        expect(written).toEqual([])
    })

    it("isn't asked again on the forced change, from a session at the account's version", async () => {
        ACCOUNTS.sara.mustChangePassword = true
        expect((await put({ id: "sara", password: "a-new-password-123" })).status).toBe(200)
        expect(written[0]).toMatchObject({ mustChangePassword: false })
    })

    it("is asked on the forced change from a session the temporary password ended", async () => {
        ACCOUNTS.sara.mustChangePassword = true
        const res = await put({ id: "sara", password: "a-new-password-123" }, { ...mine, sessionVersion: 3 })
        expect(res.status).toBe(403)
        expect(written).toEqual([])
    })

    it("isn't asked of someone setting somebody else's", async () => {
        expect((await put({ id: "sami", password: "a-new-password-123" })).status).toBe(200)
        expect(tries.count).toBe(0)
    })
})

describe("the profile's check of one's own password, POST /api/auth/verify", () => {
    it("says whether it's right, counting a wrong one", async () => {
        expect(await (await verify(CURRENT)).json()).toMatchObject({ data: { valid: true } })
        expect(await (await verify("not-it-at-all")).json()).toMatchObject({ data: { valid: false } })
        expect(tries.count).toBe(1)
    })

    it("is refused after five wrong tries, by its code", async () => {
        tries.count = 5
        const res = await verify(CURRENT)
        expect(res.status).toBe(429)
        expect(await res.json()).toMatchObject({ success: false, code: "OWN_PASSWORD_TRIES" })
    })
})
