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
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        role: { findUnique: async ({ where }: any) => db.roles[where.id] ?? null },
        user: { findUnique: async ({ where }: any) => db.users[where.id] ?? null },
        superAdmin: { findUnique: async ({ where }: any) => db.superAdmins[where.id] ?? null },
        systemSettings: { findUnique: async () => null },
    },
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
