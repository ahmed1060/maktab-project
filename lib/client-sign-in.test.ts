import { describe, it, expect, vi, beforeEach } from "vitest"
import bcrypt from "bcryptjs"
import { readFileSync } from "node:fs"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Signing in as one of a client's people (CLIENT_PORTAL_PLAN.md §5.3, §12
 * step 7b; PR 332), through authorize() and the session's callbacks, against
 * a mocked database: found by their email, held to the same lock, refused
 * where the office's portal isn't open, and their session ended within a
 * minute the same way; then the client's area's first page.
 */

const PASSWORD = "Client-pass-1x"
const HASH = bcrypt.hashSync(PASSWORD, 4)
const PERSON_HASH = bcrypt.hashSync("Person-pass-1x", 4)

type Account = Record<string, any>
const db = {
    accounts: {} as Record<string, Account>,
    users: {} as Record<string, any>,
    superAdmins: {} as Record<string, any>,
    limits: {} as Record<string, { count: number; resetAt: Date; run?: string | null }>,
    audits: [] as { action: string; entityType: string; entityId: string; options: any }[],
    updates: [] as any[],
    accountReads: 0,
    roleReads: 0,
    personReads: 0,
    closedTabs: [] as string[],
    failReads: false,
}

const company = (over: Record<string, unknown> = {}) => ({
    name: "Office One", createdAt: new Date("2026-01-01"), trialPreset: null, trialExtensionDays: 0, isBanned: false,
    package: { hasCompanyManagement: true, hasHR: false, hasClientPortal: true },
    payments: [{ endDate: new Date(Date.now() + 90 * 86_400_000), graceExtensionHours: 0 }],
    ...over,
})
const account = (over: Account = {}): Account => ({
    id: "acct-1", companyId: "co-1", clientId: "client-1", name: "Maha Adel", email: "maha@client.example", password: HASH,
    language: "ar", sessionVersion: 1,
    client: { id: "client-1", name: "Nile Trading", archivedAt: null },
    company: company(),
    ...over,
})

/** A select's fields, so a read gives back only what it asked for, as Prisma does. */
function picked(row: any, select: any): any {
    if (!select || !row) return row
    if (Array.isArray(row)) return row.map(item => picked(item, select))
    const out: any = {}
    for (const [key, want] of Object.entries(select)) {
        if (!want) continue
        out[key] = typeof want === "object" && (want as any).select ? picked(row[key], (want as any).select) : row[key]
    }
    return out
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        superAdmin: { findUnique: async ({ where }: any) => Object.values(db.superAdmins).find((a: any) => where.id ? a.id === where.id : a.email === where.email) ?? null },
        user: {
            findUnique: async ({ where }: any) => {
                if (where.id) db.personReads++
                return Object.values(db.users).find((u: any) => where.id ? u.id === where.id : u.email === where.email) ?? null
            },
            update: async () => ({}),
        },
        role: { findUnique: async () => { db.roleReads++; return null } },
        clientAccount: {
            findUnique: async ({ where, select }: any) => {
                db.accountReads++
                if (db.failReads) throw new Error("database down")
                const row = Object.values(db.accounts).find(a => where.id ? a.id === where.id : a.email === where.email)
                return row ? picked(row, select) : null
            },
            update: async ({ where, data }: any) => {
                db.updates.push({ where, data })
                Object.assign(db.accounts[where.id] ?? {}, data)
                return db.accounts[where.id]
            },
        },
        systemSettings: { findUnique: async () => null },
        $queryRaw: async () => [],
        rateLimit: {
            findUnique: async ({ where }: any) => (db.limits[where.key] ? { ...db.limits[where.key] } : null),
            upsert: async ({ where, create, update }: any) => {
                const row = db.limits[where.key]
                if (!row) return (db.limits[where.key] = { count: create.count, resetAt: create.resetAt })
                change(row, update)
                return row
            },
            update: async ({ where, data }: any) => { change(db.limits[where.key], data); return db.limits[where.key] },
            findMany: async () => [],
            delete: async ({ where }: any) => { delete db.limits[where.key] },
            create: async ({ data }: any) => {
                if (db.limits[data.key]) throw new Error("Unique constraint failed on the fields: (`key`)")
                return (db.limits[data.key] = { count: data.count, resetAt: data.resetAt, run: data.run ?? null })
            },
            updateMany: async ({ where, data }: any) => {
                const row = db.limits[where.key]
                if (!row) return { count: 0 }
                if (where.run !== undefined && (row.run ?? null) !== where.run) return { count: 0 }
                change(row, data)
                return { count: 1 }
            },
        },
    },
}))
function change(row: { count: number; resetAt: Date; run?: string | null }, data: any) {
    if (typeof data.count === "number") row.count = data.count
    else if (data.count?.increment) row.count += data.count.increment
    else if (data.count?.decrement) row.count -= data.count.decrement
    if (data.resetAt) row.resetAt = data.resetAt
    if (data.run !== undefined) row.run = data.run
}
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }))
vi.mock("@/lib/services/mfa.service", () => ({ MfaService: { verifyStoredCode: async () => false } }))
vi.mock("@/lib/services/trusted-device.service", () => ({ TrustedDeviceService: { isTrusted: async () => false } }))
vi.mock("@/lib/services/verification-code.service", () => ({ VerificationCodeService: { issue: async () => {}, verify: async () => false } }))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: {
        log: async (action: string, entityType: string, entityId: string, options: any) => { db.audits.push({ action, entityType, entityId, options }) },
        logSystemError: async () => "ref", friendlyErrorMessage: () => "error",
    },
}))
vi.mock("@/lib/services/user.service", () => ({ UserService: { closeSessionTabs: async (id: string) => { db.closedTabs.push(id) } } }))
// The client's area's page, in either language.
const page = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: page.locale, t: (key: string) => (page.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next-auth/react", () => ({ signOut: async () => {} }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }))

const { authOptions } = await import("@/lib/auth")
const { accountLockKey } = await import("@/lib/sign-in-lock")
const authorize = (credentials: Record<string, string>) => (authOptions.providers[0] as any).options.authorize(credentials, {} as any)
const jwt = (args: any) => authOptions.callbacks!.jwt!(args) as Promise<any>
const session = (token: any) => authOptions.callbacks!.session!({ session: { user: { name: token.name, email: token.email } } as any, token } as any) as Promise<any>
const signIn = (email: string, password = PASSWORD) => authorize({ email, password, remember: "false" })
/** What authorize() threw, or null. */
const refusal = async (email: string, password = PASSWORD) => { try { await signIn(email, password); return null } catch (e) { return (e as Error).message } }

beforeEach(() => {
    db.accounts = { "acct-1": account() }
    db.users = {}
    db.superAdmins = {}
    db.limits = {}
    db.audits = []
    db.updates = []
    db.accountReads = 0
    db.roleReads = 0
    db.personReads = 0
    db.closedTabs = []
    db.failReads = false
})

describe("signing in finds a client account", () => {
    it("by its email, with the right password: a client account's user, for its client and company", async () => {
        const user = await signIn("maha@client.example")
        expect(user).toMatchObject({
            id: "acct-1", role: "CLIENT_ACCOUNT", name: "Maha Adel", email: "maha@client.example",
            clientId: "client-1", clientName: "Nile Trading", companyId: "co-1", companyName: "Office One", language: "ar", sessionVersion: 1,
        })
        // Nothing of a person's: no grants, two-factor or company settings.
        for (const key of ["grants", "roleId", "featureAccess", "mfaEnabled", "username", "password"]) expect(user, key).not.toHaveProperty(key)
    })

    it("capitals and spaces at its ends aside, as the email is kept", async () => {
        expect(await signIn("  Maha@Client.EXAMPLE ")).toMatchObject({ id: "acct-1" })
    })

    it("never by a username: only the company's people have one", async () => {
        expect(await signIn("maha")).toBeNull()
        expect(db.accountReads).toBe(0)
    })

    it("is looked for only where no person or Super Admin has the email", async () => {
        db.users = { u1: { id: "u1", email: "maha@client.example", password: PERSON_HASH, role: "EMPLOYEE", status: "ACTIVE", companyId: "co-1", company: { name: "Office One", isBanned: false, package: null, payments: [] } } }
        expect(await signIn("maha@client.example")).toBeNull()
        expect(db.accountReads).toBe(0)
    })

    it("keeps when it signed in, and writes it in the audit log under the client", async () => {
        const before = Date.now()
        await signIn("maha@client.example")
        expect(db.updates).toHaveLength(1)
        expect(db.updates[0].where).toEqual({ id: "acct-1" })
        expect(db.updates[0].data.lastSignInAt.getTime()).toBeGreaterThanOrEqual(before)
        expect(db.audits).toHaveLength(1)
        expect(db.audits[0]).toMatchObject({ action: "CLIENT_SIGN_IN", entityType: "VENDOR", entityId: "client-1" })
        expect(db.audits[0].options.details).toEqual({ person: "Maha Adel", email: "maha@client.example" })
        // It's no one of the company's people or a Super Admin.
        expect(db.audits[0].options.userId ?? null).toBeNull()
        expect(db.audits[0].options.superAdminId ?? null).toBeNull()
    })

    it("asks for no two-factor code", async () => {
        expect(await refusal("maha@client.example")).toBeNull()
    })
})

describe("the same lock after wrong passwords", () => {
    it("a wrong password: no one signed in, counted on the account, and in the audit log", async () => {
        expect(await signIn("maha@client.example", "wrong")).toBeNull()
        expect(db.limits[accountLockKey("acct-1")]?.count).toBe(1)
        expect(db.updates).toEqual([])
        expect(db.audits).toHaveLength(1)
        expect(db.audits[0]).toMatchObject({ action: "CLIENT_SIGN_IN_FAILURE", entityType: "VENDOR", entityId: "client-1" })
        expect(db.audits[0].options.details).toMatchObject({ person: "Maha Adel", email: "maha@client.example", reason: "INVALID_PASSWORD" })
    })

    it("someone invited who hasn't set a password yet is refused as a wrong password is", async () => {
        db.accounts["acct-1"] = account({ password: null })
        expect(await signIn("maha@client.example", "")).toBeNull()
        expect(await signIn("maha@client.example", "anything")).toBeNull()
        expect(db.limits[accountLockKey("acct-1")]?.count).toBe(1)
        expect(db.updates).toEqual([])
    })

    it("five wrong in a row pause the account, the right password too", async () => {
        for (let i = 0; i < 5; i++) await signIn("maha@client.example", "wrong")
        expect(await refusal("maha@client.example")).toMatch(/Sign-in paused/)
        expect(db.updates).toEqual([])
    })

    it("a sign-in that succeeds starts the count over", async () => {
        await signIn("maha@client.example", "wrong")
        await signIn("maha@client.example")
        expect(db.limits[accountLockKey("acct-1")]).toBeUndefined()
    })

    it("a removed account is no one's: its email is refused as one nobody has", async () => {
        db.accounts = {}
        expect(await signIn("maha@client.example")).toBeNull()
        expect(db.limits[accountLockKey("acct-1")]).toBeUndefined()
        expect(db.audits).toEqual([])
    })
})

/** Each way the office's portal isn't open to its client's people (§5.3). */
const CLOSED: [string, Account][] = [
    ["the package hasn't the client portal", { company: company({ package: { hasCompanyManagement: true, hasHR: true, hasClientPortal: false } }) }],
    ["the company has no package", { company: company({ package: null }) }],
    ["its subscription has ended", { company: company({ createdAt: new Date("2025-01-01"), payments: [{ endDate: new Date("2025-06-01"), graceExtensionHours: 0 }] }) }],
    ["the company is barred", { company: company({ isBanned: true }) }],
    ["the client is archived", { client: { id: "client-1", name: "Nile Trading", archivedAt: new Date("2026-10-01") } }],
]

describe("refused, once the password is right, where the office's portal isn't open", () => {
    for (const [why, over] of CLOSED) {
        it(`${why}: refused with its words, the try given back, and nothing kept`, async () => {
            db.accounts["acct-1"] = account(over)
            expect(await refusal("maha@client.example")).toBe("CLIENT_PORTAL_CLOSED")
            expect(db.limits[accountLockKey("acct-1")]?.count ?? 0).toBe(0)
            expect(db.updates).toEqual([])
            expect(db.audits.map(a => a.action)).not.toContain("CLIENT_SIGN_IN")
        })
    }

    it("a wrong password says nothing of it: refused as any wrong password", async () => {
        db.accounts["acct-1"] = account(CLOSED[0][1])
        expect(await signIn("maha@client.example", "wrong")).toBeNull()
    })

    it("the sign-in page says the office's portal isn't open now, and to contact the office", async () => {
        const { signInErrorKey } = await import("./login-errors")
        expect(signInErrorKey("CLIENT_PORTAL_CLOSED")).toBe("error_client_portal_closed")
        expect(en.error_client_portal_closed).toBe("The office's portal isn't open now. Please contact the office.")
        expect(ar.error_client_portal_closed).toBe("بوابة المكتب غير متاحة الآن. يُرجى التواصل مع المكتب.")
    })
})

/** The token a client account's sign-in makes. */
async function signedIn() {
    const user = await signIn("maha@client.example")
    return jwt({ token: { sub: user.id, name: user.name, email: user.email }, user })
}
/** The same, as the minute's check finds it due. */
const due = (token: any) => ({ ...token, checkedAt: Date.now() - 61_000 })

describe("a client account's session", () => {
    it("says it's a client account's, for its client and company, with no permissions", async () => {
        const token = await signedIn()
        expect(token).toMatchObject({
            sub: "acct-1", role: "CLIENT_ACCOUNT", clientId: "client-1", clientName: "Nile Trading",
            companyId: "co-1", companyName: "Office One", language: "ar", sessionVersion: 1,
        })
        expect(token.grants).toBeUndefined()
        expect(typeof token.sid).toBe("string")
        expect(typeof token.checkedAt).toBe("number")
        expect(db.roleReads).toBe(0)
    })

    it("and the session gives the person, the client and the language", async () => {
        const s = await session(await signedIn())
        expect(s.user).toMatchObject({ id: "acct-1", role: "CLIENT_ACCOUNT", name: "Maha Adel", email: "maha@client.example", clientId: "client-1", clientName: "Nile Trading", companyId: "co-1", language: "ar" })
    })

    it("within the minute, nothing is read again and no grants are loaded", async () => {
        const token = await signedIn()
        db.accountReads = 0
        const again = await jwt({ token })
        expect(again.sub).toBe("acct-1")
        expect(again.grants).toBeUndefined()
        expect(db.accountReads).toBe(0)
        expect(db.roleReads).toBe(0)
        // Not looked for among the company's people either.
        expect(db.personReads).toBe(0)
    })

    it("after the minute, an account still open is kept, its names caught up", async () => {
        const token = await signedIn()
        db.accounts["acct-1"].client.name = "Nile Trading Co."
        db.accounts["acct-1"].company.name = "Office One Ltd"
        const checked = await jwt({ token: due(token) })
        expect(checked).toMatchObject({ sub: "acct-1", role: "CLIENT_ACCOUNT", clientName: "Nile Trading Co.", companyName: "Office One Ltd" })
        expect(checked.checkedAt).toBeGreaterThan(Date.now() - 5_000)
    })

    for (const [why, over] of CLOSED) {
        it(`ends within a minute where ${why}`, async () => {
            const token = await signedIn()
            Object.assign(db.accounts["acct-1"], over)
            expect(await jwt({ token: due(token) })).toEqual({})
        })
    }

    it("ends once the account is removed", async () => {
        const token = await signedIn()
        db.accounts = {}
        expect(await jwt({ token: due(token) })).toEqual({})
    })

    it("ends once its sessions are ended", async () => {
        const token = await signedIn()
        db.accounts["acct-1"].sessionVersion = 2
        expect(await jwt({ token: due(token) })).toEqual({})
    })

    it("ends where the check can't be made, as a person's does", async () => {
        const token = await signedIn()
        db.failReads = true
        expect(await jwt({ token: due(token) })).toEqual({})
    })

    it("an ended one is no session", async () => {
        expect(await session({})).toEqual({})
    })

    it("signing out closes no person's tabs", async () => {
        const token = await signedIn()
        await authOptions.events!.signOut!({ token, session: null as any } as any)
        expect(db.closedTabs).toEqual([])
    })
})

describe("the sign-in code", () => {
    const auth = readFileSync("lib/auth.ts", "utf8")

    it("reads a client account with what the portal's open is decided from, and its password only at sign-in", async () => {
        const { CLIENT_SESSION, CLIENT_SIGN_IN } = await import("./client-sign-in")
        expect(CLIENT_SIGN_IN).toMatchObject({ ...CLIENT_SESSION, password: true })
        expect(CLIENT_SESSION).not.toHaveProperty("password")
        expect(CLIENT_SESSION.company.select).toMatchObject({ isBanned: true, createdAt: true, trialPreset: true, trialExtensionDays: true })
        expect(CLIENT_SESSION.company.select.package.select).toMatchObject({ hasCompanyManagement: true, hasClientPortal: true })
        expect(CLIENT_SESSION.client.select).toMatchObject({ archivedAt: true, name: true })
    })

    it("decides with the invitation's rule", () => {
        const src = readFileSync("lib/client-sign-in.ts", "utf8")
        expect(src).toContain("portalOpen(")
        expect(auth).toContain("lockKeyFor(superAdmin || user || clientAccount, credentials.email)")
    })
})

describe("the client's area's first page", () => {
    const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")

    it("says the client's name above Tax position, that it will be shown there soon, and Sign out, in both languages", async () => {
        const { PortalHome } = await import("@/components/portal/PortalHome")
        for (const locale of ["en", "ar"] as const) {
            page.locale = locale
            const words = locale === "ar" ? ar : en
            const html = renderToStaticMarkup(h(PortalHome, { client: "Nile Trading" }))
            expect(html, locale).toContain(`<p class="ui-page-overline">Nile Trading</p>`)
            expect(html, locale).toContain(`<h1 class="ui-page-title">${esc(words.tax_position)}</h1>`)
            expect(html, locale).toContain(`<p class="ui-page-subtitle">${esc(words.portal_tax_soon)}</p>`)
            expect(html, locale).toContain(`>${esc(words.sign_out)}</`)
        }
        expect(en.portal_tax_soon).toBe("It will be shown here soon.")
        expect(ar.portal_tax_soon).toBe("سيُعرض هنا قريبًا.")
    })

    it("reads the client from the session, never the address, and sends anyone else on", () => {
        const src = readFileSync("app/(portal)/portal/page.tsx", "utf8")
        expect(src).toContain("getServerSession(authOptions)")
        expect(src).toContain("redirect(SESSION_ENDED_PATH)")
        expect(src).toMatch(/if \(!isClientAccount\(session\.user\)\) redirect\(['"]\/dashboard['"]\)/)
        expect(src).toContain("session.user.clientName")
        expect(src).not.toMatch(/params|searchParams/)
    })

    it("is in the area's frame: up to 1180px wide and centred, on the page colour", () => {
        const layout = readFileSync("app/(portal)/layout.tsx", "utf8")
        expect(layout).toContain(`className="ui-portal"`)
        expect(layout).toContain(`className="ui-portal-page"`)
        const css = readFileSync("components/ui/ui.css", "utf8")
        const area = /\.ui-portal-page \{([^}]*)\}/.exec(css)?.[1] ?? ""
        expect(area).toContain("max-inline-size: 1180px")
        expect(area).toContain("margin-inline: auto")
        expect(/\.ui-portal \{([^}]*)\}/.exec(css)?.[1] ?? "").toContain("background: var(--page)")
    })
})
