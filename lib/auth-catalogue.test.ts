import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A session made by an older release, after the database already holds a
 * newer catalogue's permissions (Codex on #82): preview builds migrate the
 * production database before the release that reads it is live, so the old
 * code can refresh a token at the new role version while dropping the
 * permissions it doesn't know. The token's catalogue version makes the new
 * code reload its grants once, whatever the role versions say.
 */

const db = { reads: 0 }
const ROW = { sessionVersion: 0, status: "ACTIVE", role: "EMPLOYEE", roleId: "employee", assignedRole: { version: 2 }, actingUntil: null, company: null }

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: async () => ROW },
        superAdmin: { findUnique: async () => null },
        systemSettings: { findUnique: async () => null },
    },
}))
vi.mock("@/lib/services/role.service", async (original) => {
    const real = await original<typeof import("@/lib/services/role.service")>()
    return {
        ...real,
        RoleService: Object.assign(Object.create(real.RoleService), {
            forToken: async () => {
                db.reads++
                // What the database holds now: records.view (25) and records.contribute (26) among them.
                return { roleId: "employee", roleVersion: 2, grants: "1.1,25.3,26.3" }
            },
        }),
    }
})

const { authOptions } = await import("@/lib/auth")
const { CATALOGUE_VERSION } = await import("@/lib/permissions/catalogue")
const jwt = (token: Record<string, unknown>) => authOptions.callbacks!.jwt!({ token } as never) as Promise<any>

beforeEach(() => { db.reads = 0 })

describe("a session token from an older catalogue", () => {
    it("reloads its grants once, though its role version already matches the database's", async () => {
        // Refreshed by the older release at the new version 2, without the permissions it didn't know.
        const old = { sub: "u1", role: "EMPLOYEE", sessionVersion: 0, checkedAt: Date.now(), roleId: "employee", roleVersion: 2, grants: "1.1" }
        const token = await jwt(old)
        expect(token).toMatchObject({ grants: "1.1,25.3,26.3", catalogue: CATALOGUE_VERSION })
        expect(db.reads).toBe(1)
        // Once current, it isn't read again until something changes.
        await jwt(token)
        expect(db.reads).toBe(1)
    })

    it("leaves a Super Admin's token alone: they hold no grants", async () => {
        const token = await jwt({ sub: "sa1", role: "SUPER_ADMIN", sessionVersion: 0, checkedAt: Date.now() })
        expect(token.grants).toBeUndefined()
        expect(db.reads).toBe(0)
    })
})
