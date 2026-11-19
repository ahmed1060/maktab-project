import { describe, it, expect, vi, beforeEach } from "vitest"
import bcrypt from "bcryptjs"

/**
 * Forgot your password for one of a client's people (CLIENT_PORTAL_PLAN.md
 * §5.3, §12 step 7c; PR 333), through the two routes the sign-in page's
 * reset steps call, against a mocked database: found by their email as
 * signing in finds them, sent the code a person is, and the new password
 * ending their sessions and lifting a sign-in lock.
 */

type Account = Record<string, any>
const db = {
    accounts: {} as Record<string, Account>,
    users: {} as Record<string, any>,
    issued: [] as { email: string; purpose: string; owner: unknown }[],
    codes: {} as Record<string, string>,
    cleared: [] as string[],
    audits: [] as { action: string; entityType: string; entityId: string; options: any }[],
    accountReads: 0,
    // Run once the account has been read: what changes between finding it and saving.
    afterRead: null as null | (() => void),
}
const account = (over: Account = {}): Account => ({
    id: "acct-1", companyId: "co-1", clientId: "client-1", name: "Maha Adel", email: "maha@client.example",
    password: bcrypt.hashSync("Old-password-1x", 4), activatedAt: new Date("2026-11-01"), sessionVersion: 3,
    ...over,
})

function picked(row: any, select: any): any {
    if (!select || !row) return row
    return Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, row[k]]))
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        superAdmin: { findUnique: async () => null, update: async () => ({}) },
        user: {
            findUnique: async ({ where }: any) => Object.values(db.users).find((u: any) => u.email === where.email) ?? null,
            update: async () => ({}),
        },
        // The routes' own count, never reached here, and the sign-in lock's, which a reset lifts.
        rateLimit: {
            findUnique: async () => null,
            upsert: async ({ create }: any) => ({ count: create.count, resetAt: create.resetAt }),
            update: async () => ({ count: 1, resetAt: new Date(Date.now() + 60_000) }),
            delete: async ({ where }: any) => { db.cleared.push(where.key) },
        },
        clientAccount: {
            findUnique: async ({ where, select }: any) => {
                db.accountReads++
                const found = picked(Object.values(db.accounts).find(a => a.email === where.email) ?? null, select)
                db.afterRead?.()
                db.afterRead = null
                return found
            },
            updateMany: async ({ where, data }: any) => {
                const row = db.accounts[where.id]
                if (!row || (where.activatedAt?.not === null && !row.activatedAt)) return { count: 0 }
                if (data.password) row.password = data.password
                if (data.sessionVersion?.increment) row.sessionVersion += data.sessionVersion.increment
                return { count: 1 }
            },
        },
    },
}))
vi.mock("@/lib/services/verification-code.service", () => ({
    VerificationCodeService: {
        issue: async (email: string, purpose: string, owner: unknown) => { db.issued.push({ email, purpose, owner }); db.codes[email.toLowerCase().trim()] = "123456" },
        verify: async (email: string, _purpose: string, code: string) => db.codes[email.toLowerCase().trim()] === code,
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: {
        log: async (action: string, entityType: string, entityId: string, options: any) => { db.audits.push({ action, entityType, entityId, options }) },
        logSystemError: async () => "ref", friendlyErrorMessage: () => "error",
    },
}))

const { POST: request } = await import("@/app/api/auth/forgot-password/request/route")
const { POST: confirm } = await import("@/app/api/auth/forgot-password/confirm/route")
const call = (route: typeof request, body: Record<string, string>) => route(new Request("http://localhost/api/auth/forgot-password", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" }, body: JSON.stringify(body),
}) as any)
const NEW = "New-password-2x"

beforeEach(() => {
    db.accounts = { "acct-1": account() }
    db.users = {}
    db.issued = []
    db.codes = {}
    db.cleared = []
    db.audits = []
    db.accountReads = 0
    db.afterRead = null
})

describe("Forgot your password finds one of a client's people", () => {
    it("by their email, capitals and spaces aside, and sends them the code a person is sent", async () => {
        const res = await call(request, { email: "Maha@Client.EXAMPLE" })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ data: { sent: true } })
        expect(db.issued).toEqual([{ email: "maha@client.example", purpose: "PASSWORD_RESET", owner: {} }])
    })

    it("answers the same for an email nobody has, and sends nothing", async () => {
        const res = await call(request, { email: "nobody@client.example" })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ data: { sent: true } })
        expect(db.issued).toEqual([])
    })

    it("someone invited who hasn't set a password is sent no code, with the same answer", async () => {
        db.accounts["acct-1"] = account({ password: null, activatedAt: null })
        const res = await call(request, { email: "maha@client.example" })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ data: { sent: true } })
        expect(db.issued).toEqual([])
    })

    it("is looked for only where no person has the email", async () => {
        db.users = { u1: { id: "u1", email: "maha@client.example" } }
        await call(request, { email: "maha@client.example" })
        expect(db.accountReads).toBe(0)
        expect(db.issued).toEqual([{ email: "maha@client.example", purpose: "PASSWORD_RESET", owner: { userId: "u1" } }])
    })
})

describe("a new password with the code", () => {
    it("is set, ends their open sessions, lifts a sign-in lock, and is in the audit log under the client", async () => {
        await call(request, { email: "maha@client.example" })
        const res = await call(confirm, { email: "Maha@Client.example", code: "123456", newPassword: NEW })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ data: { reset: true } })
        const row = db.accounts["acct-1"]
        expect(await bcrypt.compare(NEW, row.password)).toBe(true)
        expect(row.sessionVersion).toBe(4)
        expect(db.cleared).toContain("login:account:acct-1")
        expect(db.audits).toHaveLength(1)
        expect(db.audits[0]).toMatchObject({ action: "PASSWORD_RESET", entityType: "VENDOR", entityId: "client-1" })
        expect(db.audits[0].options.details).toEqual({ person: "Maha Adel", email: "maha@client.example" })
        expect(db.audits[0].options.userId ?? null).toBeNull()
        expect(db.audits[0].options.superAdminId ?? null).toBeNull()
    })

    it("a wrong code changes nothing", async () => {
        await call(request, { email: "maha@client.example" })
        const before = db.accounts["acct-1"].password
        const res = await call(confirm, { email: "maha@client.example", code: "000000", newPassword: NEW })
        expect(res.status).toBe(400)
        expect(db.accounts["acct-1"].password).toBe(before)
        expect(db.accounts["acct-1"].sessionVersion).toBe(3)
        expect(db.audits).toEqual([])
    })

    it("an account removed after its code was sent is not found, and nothing is written", async () => {
        await call(request, { email: "maha@client.example" })
        db.accounts = {}
        const res = await call(confirm, { email: "maha@client.example", code: "123456", newPassword: NEW })
        expect(res.status).toBe(404)
        expect(db.audits).toEqual([])
        expect(db.cleared).toEqual([])
    })

    it("an account whose password stops being set as the new one is saved is not found, and nothing is written", async () => {
        await call(request, { email: "maha@client.example" })
        db.afterRead = () => { db.accounts["acct-1"] = account({ password: null, activatedAt: null }) }
        const res = await call(confirm, { email: "maha@client.example", code: "123456", newPassword: NEW })
        expect(res.status).toBe(404)
        expect(db.accounts["acct-1"].password).toBeNull()
        expect(db.audits).toEqual([])
        expect(db.cleared).toEqual([])
    })

    it("never sets a first password for someone invited, whatever code is sent", async () => {
        db.accounts["acct-1"] = account({ password: null, activatedAt: null })
        db.codes["maha@client.example"] = "123456"
        const res = await call(confirm, { email: "maha@client.example", code: "123456", newPassword: NEW })
        expect(res.status).toBe(404)
        expect(db.accounts["acct-1"].password).toBeNull()
        expect(db.audits).toEqual([])
    })
})

describe("the save itself", () => {
    const found = { id: "acct-1", clientId: "client-1", name: "Maha Adel", email: "maha@client.example", activatedAt: new Date("2026-11-01") }

    it("holds to an account still active, in case it changed after it was found: nothing set, nothing written", async () => {
        const { resetClientPassword } = await import("./client-password-reset")
        db.accounts["acct-1"] = account({ password: null, activatedAt: null })
        expect(await resetClientPassword(found, NEW)).toBe(false)
        expect(db.accounts["acct-1"].password).toBeNull()
        expect(db.accounts["acct-1"].sessionVersion).toBe(3)
        expect(db.cleared).toEqual([])
        expect(db.audits).toEqual([])
    })

    it("and to one still there", async () => {
        const { resetClientPassword } = await import("./client-password-reset")
        db.accounts = {}
        expect(await resetClientPassword(found, NEW)).toBe(false)
        expect(db.cleared).toEqual([])
        expect(db.audits).toEqual([])
    })
})
