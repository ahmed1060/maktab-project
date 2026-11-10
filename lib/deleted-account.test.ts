import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"

/**
 * An account deleted while it's signed in (PR 247). Deleting someone left the
 * session they had working: the server refused only a suspended, closed or
 * banned account, the heartbeat said a deleted one was active, and a row
 * deleted outright left a session that matched nothing, which nothing ended.
 *
 *   - Deleted (the row kept, as Ghost User): refused like a suspension, on
 *     every request and on every page that reads the database, and the
 *     heartbeat signs the browser out once the work open on it is saved.
 *   - Deleted outright (no row): the minute's check ends the session.
 */

const db = {
    users: {} as Record<string, any>,
    superAdmins: {} as Record<string, any>,
    updated: [] as string[],
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: async ({ where }: any) => db.users[where.id] ?? null,
            update: async ({ where }: any) => { db.updated.push(where.id); return db.users[where.id] },
        },
        superAdmin: { findUnique: async ({ where }: any) => db.superAdmins[where.id] ?? null },
        role: { findUnique: async () => null },
        systemSettings: { findUnique: async () => null },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async () => {}, logSystemError: async () => "ref" },
}))

const { authOptions } = await import("@/lib/auth")
const { CATALOGUE_VERSION } = await import("@/lib/permissions/catalogue")
const { accountRefusal } = await import("@/lib/account-refusal")
const { UserService } = await import("@/lib/services/user.service")
const jwt = (token: any) => authOptions.callbacks!.jwt!({ token } as any) as Promise<any>
const session = (token: any) => authOptions.callbacks!.session!({ session: { user: {} } as any, token } as any) as Promise<any>

// A token whose minute's check is due, as any request a minute after the last finds it.
const due = (token: Record<string, unknown>) => ({ checkedAt: 0, sessionVersion: 0, grants: "", catalogue: CATALOGUE_VERSION, ...token })

beforeEach(() => {
    db.users = {}
    db.superAdmins = {}
    db.updated = []
})

describe("an account deleted, its row kept", () => {
    it("is refused like a suspended one, on every request and page that asks", () => {
        expect(accountRefusal({ role: "EMPLOYEE", userStatus: "DELETED" })).toBe("SUSPENDED")
        expect(accountRefusal({ role: "ADMIN", userStatus: "DELETED" })).toBe("SUSPENDED")
    })

    it("is refused from the next minute's check of its session on", async () => {
        db.users.e1 = { status: "DELETED", sessionVersion: 0, company: { isBanned: false } }
        const token = await jwt(due({ sub: "e1", role: "EMPLOYEE", companyId: "c1", userStatus: "ACTIVE" }))
        expect(token.userStatus).toBe("DELETED")
        expect(accountRefusal((await session(token)).user)).toBe("SUSPENDED")
    })

    it("is told so by the heartbeat, which signs the browser out", async () => {
        db.users.e1 = { status: "DELETED", company: { isBanned: false } }
        expect(await UserService.updateActivity("e1", "EMPLOYEE")).toEqual({ success: true, status: "DELETED" })
        // Deleted is said before a banned company: it's the account's own.
        db.users.e1 = { status: "DELETED", company: { isBanned: true } }
        expect((await UserService.updateActivity("e1", "EMPLOYEE")).status).toBe("DELETED")

        const heartbeat = readFileSync("components/UserHeartbeat.tsx", "utf8")
        const branch = heartbeat.slice(heartbeat.indexOf("data.status === 'DELETED'"))
        expect(branch.length).toBeLessThan(heartbeat.length)
        // As a suspension: the work open on the page is saved, then the browser is signed out.
        expect(branch.slice(0, 400)).toContain("app:suspend-detected")
        expect(branch.slice(0, 400)).toContain("waitForEmergencySave().then(() => signOut({ callbackUrl: '/login' }))")
        expect(heartbeat).toContain("[t('account_deleted'), t('deleted_msg')]")
    })

    it("says what happened in both languages, as the other reasons do", async () => {
        const { en } = await import("@/lib/translations/en")
        const { ar } = await import("@/lib/translations/ar")
        expect(en.account_deleted).toBe("Account deleted")
        expect(en.deleted_msg).toBe("Your account has been deleted by an administrator.")
        expect(ar.account_deleted).toBe("الحساب محذوف")
        expect(ar.deleted_msg).toBe("تم حذف حسابك بواسطة المسؤول.")
    })
})

describe("an account deleted outright", () => {
    it("ends its session at the next minute's check", async () => {
        expect(await jwt(due({ sub: "gone", role: "EMPLOYEE", companyId: "c1", userStatus: "ACTIVE" }))).toEqual({})
        // Emptied, the token gives a session with no one in it: signed out (proxy.ts).
        expect((await session({})).user?.id).toBeUndefined()
    })

    it("and a Super Admin's too", async () => {
        expect(await jwt(due({ sub: "sa-gone", role: "SUPER_ADMIN" }))).toEqual({})
    })

    it("keeps a session whose account is there, as before", async () => {
        db.users.e1 = { status: "ACTIVE", sessionVersion: 0, company: { isBanned: false } }
        db.superAdmins.sa = { sessionVersion: 0 }
        expect((await jwt(due({ sub: "e1", role: "EMPLOYEE", companyId: "c1" }))).sub).toBe("e1")
        expect((await jwt(due({ sub: "sa", role: "SUPER_ADMIN" }))).sub).toBe("sa")
    })
})
