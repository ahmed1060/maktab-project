import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A new password ends the account's other sessions (UI_PLAN.md change log,
 * PR 228): a temporary one an Admin gives, one set on the profile, one's own
 * or somebody else's, and the one the Change password page asks for. Only a
 * reset by email did (PR 198): signed in elsewhere with the old password,
 * such as by someone who had learned it, the account stayed signed in there.
 *
 * The session a person sets their own from is kept: the account remembers
 * it, at the version that ended the others (lib/session-kept.ts), so every
 * request it makes meanwhile is still its own, rather than refused and
 * signed out while it catches up.
 */

const SECRET = "password-ends-sessions-test-secret-0123"
vi.stubEnv("NEXTAUTH_SECRET", SECRET)

const db = { users: {} as Record<string, any>, superAdmins: {} as Record<string, any> }
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: async ({ where }: any) => db.users[where.id] ?? null },
        superAdmin: { findUnique: async ({ where }: any) => db.superAdmins[where.id] ?? null },
        systemSettings: { findUnique: async () => null },
    },
}))

const { authOptions } = await import("@/lib/auth")
const { CATALOGUE_VERSION } = await import("@/lib/permissions/catalogue")
const { keptSession, isKept, keepAfterChange } = await import("@/lib/session-kept")
const jwt = (token: any, user?: any) => authOptions.callbacks!.jwt!({ token, user } as any) as Promise<any>

/** A token whose minute's check is due, from the browser named "mine". */
const due = (token: Record<string, unknown> = {}) => ({ sub: "u1", role: "EMPLOYEE", sid: "mine", sessionVersion: 0, checkedAt: 0, grants: "", catalogue: CATALOGUE_VERSION, ...token })
const ROW = { sessionVersion: 0, keptSession: null, status: "ACTIVE", role: "EMPLOYEE", roleId: null, assignedRole: null, actingUntil: null, company: null, emailVerifiedAt: new Date(), mfaEnabled: false }
const SUPER_ADMIN = { sessionVersion: 0, keptSession: null, isProtected: false, emailVerifiedAt: new Date(), mfaEnabled: true }

beforeEach(() => { db.users = {}; db.superAdmins = {} })

describe("a browser's session", () => {
    it("is named when it signs in", async () => {
        const token = await jwt({ sub: "sa1" }, { id: "sa1", role: "SUPER_ADMIN", firstName: "Sara", lastName: "Adel" })
        expect(token.sid).toMatch(/^[0-9a-f-]{36}$/)
        const other = await jwt({ sub: "sa1" }, { id: "sa1", role: "SUPER_ADMIN", firstName: "Sara", lastName: "Adel" })
        expect(other.sid).not.toBe(token.sid)
    })

    it("keeps its name, and one from before it had a name is given one", async () => {
        db.users.u1 = { ...ROW }
        expect((await jwt(due())).sid).toBe("mine")
        // Written back to its cookie the next time the session is read.
        const named = await jwt(due({ sid: undefined }))
        expect(named.sid).toMatch(/^[0-9a-f-]{36}$/)
        // A session the server ended has nobody in it to name.
        expect(await jwt({})).toEqual({})
    })
})

describe("a new password", () => {
    it("ends the account's other sessions at their next check", async () => {
        db.users.u1 = { ...ROW, sessionVersion: 1, keptSession: keptSession(1, "mine") }
        expect((await jwt(due({ sid: "theirs" }))).sub).toBeUndefined()
    })

    it("keeps the session it was set from, at the version that ended the others", async () => {
        db.users.u1 = { ...ROW, sessionVersion: 1, keptSession: keptSession(1, "mine") }
        const token = await jwt(due())
        expect(token.sub).toBe("u1")
        expect(token.sessionVersion).toBe(1)
        // Then it's at the account's version, as any session is.
        expect((await jwt({ ...token, checkedAt: 0 })).sub).toBe("u1")
    })

    it("keeps it only at that version: ending the account's sessions later ends it too", async () => {
        db.users.u1 = { ...ROW, sessionVersion: 2, keptSession: keptSession(1, "mine") }
        expect((await jwt(due())).sub).toBeUndefined()
        expect((await jwt(due({ sessionVersion: 1 }))).sub).toBeUndefined()
    })

    it("keeps nothing for a session with no name", async () => {
        db.users.u1 = { ...ROW, sessionVersion: 1, keptSession: "1:undefined" }
        expect((await jwt(due({ sid: undefined }))).sub).toBeUndefined()
        db.users.u1 = { ...ROW, sessionVersion: 1, keptSession: "1:" }
        expect((await jwt(due({ sid: "" }))).sub).toBeUndefined()
    })

    it("is the same for a Super Admin", async () => {
        db.superAdmins.sa1 = { ...SUPER_ADMIN, sessionVersion: 3, keptSession: keptSession(3, "mine") }
        const sa = (sid: string) => due({ sub: "sa1", role: "SUPER_ADMIN", sid, sessionVersion: 2 })
        expect((await jwt(sa("mine"))).sessionVersion).toBe(3)
        expect((await jwt(sa("theirs"))).sub).toBeUndefined()
    })

    it("leaves a session alone until its minute's check, as before", async () => {
        db.users.u1 = { ...ROW, sessionVersion: 1, keptSession: keptSession(1, "mine") }
        expect((await jwt(due({ sid: "theirs", checkedAt: Date.now() }))).sub).toBe("u1")
    })
})

describe("the session an account keeps when a password is set", () => {
    const account = (sessionVersion: number, kept: string | null = null) => ({ sessionVersion, keptSession: kept })

    it("is the one it was set from, at the version it moves to", () => {
        expect(keepAfterChange(account(4), { sid: "mine", sessionVersion: 4 })).toBe("5:mine")
        expect(isKept({ sessionVersion: 5, keptSession: "5:mine" }, { sid: "mine" })).toBe(true)
    })

    it("is kept again by a second change, before its cookie has caught up with the first", () => {
        expect(keepAfterChange(account(5, keptSession(5, "mine")), { sid: "mine", sessionVersion: 4 })).toBe("6:mine")
    })

    it("isn't one the account had already ended, though it wasn't yet told", () => {
        // Ended by a reset by email a moment before: its check isn't due yet.
        expect(keepAfterChange(account(5), { sid: "theirs", sessionVersion: 4 })).toBeNull()
        expect(keepAfterChange(account(5, keptSession(5, "mine")), { sid: "theirs", sessionVersion: 4 })).toBeNull()
    })

    it("is none without a session that has a name", () => {
        expect(keepAfterChange(account(4), { sessionVersion: 4 })).toBeNull()
        expect(keepAfterChange(account(4), { sid: "", sessionVersion: 4 })).toBeNull()
        expect(keepAfterChange(account(4), null)).toBeNull()
        expect(keepAfterChange(account(4), undefined)).toBeNull()
    })
})
