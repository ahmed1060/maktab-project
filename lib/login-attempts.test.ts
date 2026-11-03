import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import bcrypt from "bcryptjs"

/**
 * Sign-in's limit, run through authorize() against a mocked database: five
 * wrong tries in a row pause the account for 30 seconds, ten lock it for
 * fifteen minutes (decided 2026-11-03), where five locked it. Found on production: a Super Admin with
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
    ip: "203.0.113.7",
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
            upsert: async ({ where, create, update }: any) => {
                const row = db.limits[where.key]
                if (!row) return (db.limits[where.key] = { count: create.count, resetAt: create.resetAt })
                change(row, update)
                return row
            },
            update: async ({ where, data }: any) => { change(db.limits[where.key], data); return db.limits[where.key] },
            findMany: async ({ where }: any) => Object.entries(db.limits)
                .filter(([key, row]) => where.key.in.includes(key) && row.count >= where.count.gte && row.resetAt > where.resetAt.gt)
                .map(([key, row]) => ({ key, resetAt: row.resetAt })),
            delete: async ({ where }: any) => { delete db.limits[where.key] },
            updateMany: async ({ where, data }: any) => {
                const row = db.limits[where.key]
                const sameWindow = !(where.resetAt instanceof Date) || row?.resetAt.getTime() === where.resetAt.getTime()
                const ranOut = !where.resetAt?.lte || row?.resetAt <= where.resetAt.lte
                if (row && sameWindow && ranOut && row.count > (where.count?.gt ?? -Infinity)) { change(row, data); return { count: 1 } }
                return { count: 0 }
            },
        },
    },
}))
function change(row: { count: number; resetAt: Date }, data: any) {
    if (typeof data.count === "number") row.count = data.count
    else if (data.count?.increment) row.count += data.count.increment
    else if (data.count?.decrement) row.count -= data.count.decrement
    if (data.resetAt) row.resetAt = data.resetAt
}
const failures: string[] = []
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": db.ip }) }))
// The authenticator itself: "123456" is right, anything else is not.
vi.mock("@/lib/services/mfa.service", () => ({
    MfaService: { verifyStoredCode: async (_secret: string, code: string) => code === "123456" },
}))
vi.mock("@/lib/services/trusted-device.service", () => ({ TrustedDeviceService: { isTrusted: async () => false } }))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: {
        log: async (action: string) => {
            if (action === "LOGIN_FAILURE") failures.push(action)
            if (action === "LOGIN" && db.failLogin) throw new Error("audit down")
        },
        logSystemError: async () => "ref", friendlyErrorMessage: () => "error",
    },
}))
// The code sent by email for "email me a code instead".
vi.mock("@/lib/services/verification-code.service", () => ({
    VerificationCodeService: { issue: async () => {}, verify: async (_email: string, _purpose: string, code: string) => code === "654321" },
}))

const { authOptions } = await import("@/lib/auth")
const { RateLimiter } = await import("@/lib/api-utils")
const { POST: askForCode } = await import("@/app/api/auth/mfa-recovery/request/route")
const emailMeACode = (body: Record<string, string>) => askForCode(new Request("http://localhost/api/auth/mfa-recovery/request", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" }, body: JSON.stringify(body),
}) as any)
const authorize = (credentials: Record<string, string>) =>
    (authOptions.providers[0] as any).options.authorize(credentials, {} as any)

const email = "sa@example.test"
const password = "the-right-password"

// The clock, moved on by hand: only Date, as bcrypt runs on the real timers.
const later = (ms: number) => vi.setSystemTime(Date.now() + ms)
afterEach(() => { vi.useRealTimers() })

/** n wrong passwords in a row, waiting out the 30 seconds after the fifth. */
async function wrong(n: number, who: Record<string, string> = { email }) {
    for (let i = 1; i <= n; i++) {
        expect(await authorize({ ...who, password: "wrong" }), `wrong try ${i}`).toBeNull()
        if (i === 5) later(31_000)
    }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-03T12:00:00Z") })
    failures.length = 0
    db.limits = {}
    db.failLogin = false
    db.ip = "203.0.113.7"
    db.superAdmins = {
        sa: { id: "sa", email, password: bcrypt.hashSync(password, 4), firstName: "S", lastName: "A", mfaEnabled: true, mfaSecret: "stored", emailVerifiedAt: new Date() },
        // Somebody else at the same office, without an authenticator.
        colleague: { id: "colleague", email: "colleague@example.test", password: bcrypt.hashSync(password, 4), firstName: "C", lastName: "O", mfaEnabled: false, emailVerifiedAt: new Date() },
    }
    db.users = {
        held: {
            id: "held", email: "held@example.test", password: bcrypt.hashSync(password, 4), firstName: "H", lastName: "D",
            role: "EMPLOYEE", status: "SUSPENDED", companyId: "c1", company: { id: "c1", name: "One", isBanned: false, package: null, payments: [] },
        },
    }
})

describe("signing in, a pause after five wrong tries and a lock after ten", () => {
    it("counts neither the step that asks for the code nor a sign-in that succeeds", async () => {
        for (let i = 0; i < 4; i++) {
            await expect(authorize({ email, password })).rejects.toThrow("MFA_REQUIRED")
            expect(await authorize({ email, password, mfaCode: "123456" }), `sign-in ${i + 1}`).toMatchObject({ id: "sa" })
        }
    })

    it("pauses the account for 30 seconds after five wrong passwords in a row, and checks nothing meanwhile", async () => {
        await wrong(4)
        expect(await authorize({ email, password: "wrong" })).toBeNull()
        await expect(authorize({ email, password, mfaCode: "123456" })).rejects.toThrow("Sign-in paused")
        later(20_000)
        await expect(authorize({ email, password: "wrong" })).rejects.toThrow("Sign-in paused")
        // Turned away during the pause, so not counted.
        expect(db.limits["login:account:sa"].count).toBe(5)
        expect(failures).toHaveLength(5)
    })

    it("lets them try again once the 30 seconds are up", async () => {
        await wrong(5)
        expect(await authorize({ email, password, mfaCode: "123456" })).toMatchObject({ id: "sa" })
    })

    it("locks the account for fifteen minutes after ten wrong passwords in a row", async () => {
        await wrong(10)
        await expect(authorize({ email, password, mfaCode: "123456" })).rejects.toThrow("Too many login attempts")
        later(14 * 60_000)
        await expect(authorize({ email, password, mfaCode: "123456" })).rejects.toThrow("Too many login attempts")
        later(61_000)
        expect(await authorize({ email, password, mfaCode: "123456" })).toMatchObject({ id: "sa" })
    })

    it("counts wrong codes as it counts wrong passwords", async () => {
        for (let i = 0; i < 5; i++) await expect(authorize({ email, password, mfaCode: "000000" })).rejects.toThrow("INVALID_MFA_CODE")
        await expect(authorize({ email, password, mfaCode: "123456" })).rejects.toThrow("Sign-in paused")
        later(31_000)
        for (let i = 0; i < 5; i++) await expect(authorize({ email, password, mfaCode: "000000" })).rejects.toThrow("INVALID_MFA_CODE")
        await expect(authorize({ email, password, mfaCode: "123456" })).rejects.toThrow("Too many login attempts")
    })

    it("starts over after a sign-in that succeeds, as the tries are counted in a row", async () => {
        await wrong(4)
        expect(await authorize({ email, password, mfaCode: "123456" })).toMatchObject({ id: "sa" })
        await wrong(4)
        expect(await authorize({ email, password, mfaCode: "123456" })).toMatchObject({ id: "sa" })
    })

    it("lets no more through than the pause allows when they're all sent at once", async () => {
        // Each try is counted before the password is checked, so tries sent
        // together can't all find the count where it was.
        const tries = await Promise.all(Array.from({ length: 20 }, () => authorize({ email, password: "wrong" }).catch((e: Error) => e.message)))
        expect(failures).toHaveLength(5)
        expect(tries.filter(t => typeof t === "string" && t.includes("Sign-in paused"))).toHaveLength(15)
        expect(db.limits["login:account:sa"].count).toBe(5)
    })

    it("forgets a run fifteen minutes after its last wrong try", async () => {
        await wrong(9)
        later(15 * 60_000 + 1000)
        await wrong(4)
        expect(db.limits["login:account:sa"].count).toBe(4)
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

    it("asking for a code by email with the right password, as the step that asks for the code does", async () => {
        for (let i = 0; i < 6; i++) {
            const res = await emailMeACode({ email, password })
            expect(res.status, `request ${i + 1}`).toBe(200)
        }
        expect(await authorize({ email, password, mfaRecoveryCode: "654321" })).toMatchObject({ id: "sa" })
        // A wrong password there still counts.
        for (let i = 0; i < 5; i++) expect((await emailMeACode({ email, password: "wrong" })).status).toBe(403)
        expect((await emailMeACode({ email, password })).status).toBe(429)
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
        // The step that asks for the code gives its try back; then the code
        // is wrong. That one stays counted, and nothing is given back twice.
        await expect(authorize({ email, password })).rejects.toThrow("MFA_REQUIRED")
        await expect(authorize({ email, password, mfaCode: "000000" })).rejects.toThrow("INVALID_MFA_CODE")
        expect(db.limits["login:account:sa"].count).toBe(1)
        // A sign-in that succeeds forgets the run, even if writing it down
        // fails after; the next wrong try starts a new one.
        db.superAdmins.sa.mfaEnabled = false
        db.failLogin = true
        await expect(authorize({ email, password })).rejects.toThrow("audit down")
        expect(db.limits["login:account:sa"]).toBeUndefined()
        db.failLogin = false
        expect(await authorize({ email, password: "wrong" })).toBeNull()
        expect(db.limits["login:account:sa"].count).toBe(1)
    })
})

describe("the lock is the account's, not the address's (decided 2026-11-03)", () => {
    const colleague = { email: "colleague@example.test", password }

    it("leaves somebody else at the same address alone, where one person's five wrong passwords locked the whole office", async () => {
        await wrong(10)
        await expect(authorize({ email, password })).rejects.toThrow("Too many login attempts")
        expect(await authorize(colleague)).toMatchObject({ id: "colleague" })
    })

    it("keeps the account locked from another address", async () => {
        await wrong(10)
        db.ip = "198.51.100.9"
        await expect(authorize({ email, password, mfaCode: "123456" })).rejects.toThrow("Too many login attempts")
    })

    it("locks an email nobody has the same way, so a lock doesn't say which emails exist", async () => {
        const nobody = { email: "nobody@example.test", password: "wrong" }
        await wrong(4, nobody)
        expect(await authorize(nobody)).toBeNull()
        await expect(authorize(nobody)).rejects.toThrow("Sign-in paused")
        later(31_000)
        await wrong(5, nobody)
        await expect(authorize(nobody)).rejects.toThrow("Too many login attempts")
        // Kept as a hash, not as it was typed.
        expect(Object.keys(db.limits).some(key => key.includes("nobody"))).toBe(false)
    })

    it("counts an email in other capitals on its own, as finding the account does, so a pause says nothing of who's registered (Codex on PR 183)", async () => {
        // Finding the account matches the email as typed. Counted with its
        // capitals set aside, five wrong tries as NOBODY@ paused nobody@ when
        // nobody had it, and not when somebody did, as theirs is the account's.
        for (const who of ["nobody@example.test", colleague.email]) {
            // Five wrong, and asked again within the 30 seconds.
            for (let i = 0; i < 5; i++) expect(await authorize({ email: who.toUpperCase(), password: "wrong" })).toBeNull()
            await expect(authorize({ email: who.toUpperCase(), password: "wrong" })).rejects.toThrow("Sign-in paused")
            expect(await authorize({ email: who, password: "wrong" }), who).toBeNull()
        }
    })

    it("lifts when it's unlocked, and the count of codes for sensitive actions with it", async () => {
        const { unlockSignIn, lockedUntil } = await import("@/lib/sign-in-lock")
        await wrong(5, { email: colleague.email })
        // The 30 seconds aren't shown in the lists; the fifteen minutes are.
        expect((await lockedUntil(["colleague"])).size).toBe(0)
        await wrong(5, { email: colleague.email })
        expect((await lockedUntil(["colleague", "sa"])).has("colleague")).toBe(true)
        expect((await lockedUntil(["colleague", "sa"])).has("sa")).toBe(false)
        db.limits["step-up:colleague"] = { count: 5, resetAt: new Date(Date.now() + 60_000) }
        await unlockSignIn("colleague")
        expect((await lockedUntil(["colleague"])).size).toBe(0)
        expect(db.limits["step-up:colleague"]).toBeUndefined()
        expect(await authorize(colleague)).toMatchObject({ id: "colleague" })
    })

    it("counts \"email me a code instead\" against the account too", async () => {
        for (let i = 0; i < 5; i++) expect((await emailMeACode({ email, password: "wrong" })).status).toBe(403)
        expect((await emailMeACode({ email, password })).status).toBe(429)
        expect(db.limits["login:account:sa"].count).toBe(5)
        // Somebody else at the same address isn't held up by it.
        expect(await authorize(colleague)).toMatchObject({ id: "colleague" })
    })

    it("is lifted by resetting the password with Forgot password, which proves the email is theirs", async () => {
        const { readFileSync } = await import("node:fs")
        const src = readFileSync("app/api/auth/forgot-password/confirm/route.ts", "utf8")
        expect(src).toContain("await unlockSignIn(")
    })

    it("has no per-address count left in sign-in", async () => {
        const { readFileSync } = await import("node:fs")
        for (const path of ["lib/auth.ts", "app/api/auth/mfa-recovery/request/route.ts"]) {
            expect(readFileSync(path, "utf8"), path).not.toContain("login:${ip}")
        }
    })
})
