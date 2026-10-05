import { describe, it, expect, vi } from "vitest"

/**
 * While the Super Admin previews a role (ROLES_PLAN.md §6.6) the session
 * presents that role, but the id is still the Super Admin's. The heartbeat
 * looks the account up by id, so it must ask what kind of account it is — not
 * what role is being shown — or it goes looking in the wrong table.
 */

const state = { session: null as any, asked: [] as string[] }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/services/user.service", () => ({
    UserService: { updateActivity: async (id: string, role: string) => { state.asked.push(`${id}:${role}`); return { status: "ACTIVE" } } },
}))

const { POST } = await import("@/app/api/user/activity/route")
const { accountKind } = await import("@/lib/security")

describe("the heartbeat while previewing a role", () => {
    it("is answered for the Super Admin's own account", async () => {
        state.session = { user: { id: "sa", role: "EMPLOYEE", companyId: "c1", grants: "", preview: { roleId: "r1", roleName: "HR", companyId: "c1", companyName: "One" } } }
        const res = await POST(new Request("https://nizmo.test/api/user/activity", { method: "POST" }))
        expect(res.status).toBe(200)
        expect(state.asked).toEqual(["sa:SUPER_ADMIN"])
    })

    it("tells the kind of account apart from the role shown", () => {
        expect(accountKind({ role: "EMPLOYEE", preview: { roleId: "r1" } })).toBe("SUPER_ADMIN")
        expect(accountKind({ role: "EMPLOYEE" })).toBe("EMPLOYEE")
        expect(accountKind({ role: "SUPER_ADMIN" })).toBe("SUPER_ADMIN")
    })
})
