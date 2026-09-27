import { describe, it, expect, vi } from "vitest"
import { withGrants } from "./test-actors"

/**
 * withStandardHandler's `permission` option refuses a caller who does not hold
 * the permission, before the handler runs — the same place, and the same 403,
 * as `allowedRoles`, which it replaces route by route.
 */

const state = { session: null as any, ran: false }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const { withStandardHandler } = await import("@/lib/api-utils")
const { ApiResponse } = await import("@/lib/api-response")

const handler = withStandardHandler(async () => {
    state.ran = true
    return ApiResponse.success({})
}, { permission: "payroll.approve" })

async function call(role: string) {
    state.ran = false
    state.session = { user: withGrants({ id: "u", role, companyId: "c1" }) }
    const res = await handler(new Request("https://nizmo.test/api/anything"))
    return { status: res.status, ran: state.ran }
}

describe("withStandardHandler({ permission })", () => {
    it("lets a holder through", async () => {
        expect(await call("ADMIN")).toEqual({ status: 200, ran: true })
        expect(await call("SUPER_ADMIN")).toEqual({ status: 200, ran: true })
    })

    it("refuses anybody else before the handler runs", async () => {
        expect(await call("TEAM_LEADER")).toEqual({ status: 403, ran: false })
        expect(await call("EMPLOYEE")).toEqual({ status: 403, ran: false })
    })
})

/**
 * Previewing a role (ROLES_PLAN.md §6.6) is read-only: whatever the previewed
 * role holds, every write is refused while it lasts — reads answer as they
 * would for a holder.
 */
describe("while the Super Admin previews a role", () => {
    const open = withStandardHandler(async () => { state.ran = true; return ApiResponse.success({}) })
    const previewing = () => ({ user: { ...withGrants({ id: "sa", role: "ADMIN", companyId: "c1" }), preview: { roleId: "r1", roleName: "Admin", companyId: "c1", companyName: "One" } } })

    it("reads answer", async () => {
        state.session = previewing(); state.ran = false
        expect((await open(new Request("https://nizmo.test/api/anything"))).status).toBe(200)
        expect(state.ran).toBe(true)
    })

    it.each(["POST", "PUT", "PATCH", "DELETE"])("%s is refused before the handler runs", async method => {
        state.session = previewing(); state.ran = false
        expect((await open(new Request("https://nizmo.test/api/anything", { method }))).status).toBe(403)
        expect(state.ran).toBe(false)
    })
})
