import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, obligationState, url, withBody } from "./obligation-access.harness"
import { encodeGrants } from "./grants"
import { stepUpConfirmed } from "./test-actors"

vi.setConfig({ testTimeout: 60_000 })

/**
 * A role that sees every obligation but manages only its team's:
 * obligations.view for the company, obligations.manage for a team. "tl" leads
 * "emp"; "loner" is outside the team.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const P = (id: string) => ({ params: { id } })
const route = () => import("@/app/api/obligations/[id]/route")
const onRole = () => {
    state.session = { user: stepUpConfirmed({ id: "tl", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "obligations.view": "COMPANY", "obligations.manage": "TEAM", "employees.view": "COMPANY" }) }) }
}
const approve = async (o: string) => { obligationState.status = "COMPLETED"; return (await route()).PUT(withBody("PUT", `/api/obligations/${o}`, { status: "APPROVED" }), P(o)) }
const remove = async (o: string) => { obligationState.status = "IN_PROGRESS"; return (await route()).DELETE(new Request(url(`/api/obligations/${o}`), { method: "DELETE" }), P(o)) }

describe("a role that sees every obligation and manages its team's", () => {
    it("approves and deletes their team's", async () => {
        onRole()
        expect((await approve("o-emp")).status).toBe(200)
        expect((await remove("o-emp")).status).toBe(200)
    })

    it("not another's in the company", async () => {
        onRole()
        expect((await approve("o-loner")).status).toBe(403)
        expect((await remove("o-loner")).status).toBe(403)
    })
})
