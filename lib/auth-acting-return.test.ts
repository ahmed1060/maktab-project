import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The minute's check in the session's jwt() callback, once an acting role is
 * over but the nightly job has not yet moved the person back (ROLES_PLAN.md
 * §6.13). The row and the token both still name the acting role, so only a
 * fresh read of the return shows an edit to the role returned to.
 */

const db = { row: null as Record<string, unknown> | null, returnGrants: "", reads: 0 }

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: async () => db.row },
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
                const row = db.row as { roleId: string; actingUntil: Date | null }
                const due = !!row.actingUntil && row.actingUntil <= new Date()
                return due
                    ? { roleId: row.roleId, roleVersion: 1, grants: db.returnGrants, role: "EMPLOYEE", actingEnded: true }
                    : { roleId: row.roleId, roleVersion: 1, grants: `held:${row.roleId}`, actingEnded: undefined }
            },
        }),
    }
})

const { authOptions } = await import("@/lib/auth")
const { CATALOGUE_VERSION } = await import("@/lib/permissions/catalogue")
const jwt = (token: Record<string, unknown>) => authOptions.callbacks!.jwt!({ token } as never) as Promise<any>

// A token whose minute has passed, so this call checks the row again.
const due = (token: Record<string, unknown>) => ({ sub: "u1", role: "EMPLOYEE", sessionVersion: 0, checkedAt: 0, catalogue: CATALOGUE_VERSION, ...token })
const acting = (actingUntil: Date | null, roleId = "cover") => ({
    sessionVersion: 0, status: "ACTIVE", role: "EMPLOYEE", roleId, assignedRole: { version: 1 }, actingUntil, company: null,
})

beforeEach(() => {
    db.row = null
    db.returnGrants = ""
    db.reads = 0
})

describe("once an acting role is over, before the nightly job moves the person back", () => {
    it("follows an edit to the role returned to at every check, not only the first (review on #3)", async () => {
        db.row = acting(new Date(Date.now() - 60_000))
        db.returnGrants = "return-as-it-was"
        const first = await jwt(due({ roleId: "cover", roleVersion: 1, grants: "acting" }))
        expect(first).toMatchObject({ grants: "return-as-it-was", actingEnded: true, role: "EMPLOYEE" })

        // The role they return to loses a permission. The row still names the
        // acting role, at the same version, as the token does.
        db.returnGrants = "return-as-it-is-now"
        const next = await jwt({ ...first, checkedAt: 0 })
        expect(next.grants).toBe("return-as-it-is-now")
        expect(db.reads).toBe(2)
    })

    it("reads nothing again while the acting role still holds", async () => {
        db.row = acting(new Date(Date.now() + 86_400_000))
        const token = await jwt(due({ roleId: "cover", roleVersion: 1, grants: "acting" }))
        expect(token.grants).toBe("acting")
        expect(db.reads).toBe(0)
    })

    it("reads the new role once the job has moved them back", async () => {
        db.row = acting(null, "employee")
        const token = await jwt(due({ roleId: "cover", roleVersion: 1, grants: "return-as-it-was", actingEnded: true }))
        expect(token).toMatchObject({ roleId: "employee", grants: "held:employee", actingEnded: undefined })
        expect(db.reads).toBe(1)
    })
})
