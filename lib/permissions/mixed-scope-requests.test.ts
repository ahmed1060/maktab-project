import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, requestState, url, withBody } from "./request-access.harness"
import { encodeGrants } from "./grants"
import { stepUpConfirmed } from "./test-actors"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Requests are decided by the requests permissions, each at its own scope:
 * a role may see every request yet review only its team's, and a
 * team-scoped reviewer is held to the team whatever it may see of people.
 * "tl" leads "emp"; "loner" is outside the team.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const P = (id: string) => ({ params: { id } })
const one = () => import("@/app/api/requests/[id]/route")
const onRole = (grants: Record<string, string>) => {
    requestState.status = "PENDING"
    state.session = { user: stepUpConfirmed({ id: "tl", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(grants as any) }) }
}
const view = async (id: string) => (await one()).GET(new Request(url(`/api/requests/${id}`)), P(id))
const decide = async (id: string) => (await one()).PATCH(withBody("PATCH", `/api/requests/${id}`, { status: "IN_PROGRESS" }), P(id))
const remove = async (id: string) => (await one()).DELETE(new Request(url(`/api/requests/${id}`), { method: "DELETE" }), P(id))

describe("a role that sees every request and reviews its team's", () => {
    const grants = { "requests.view": "COMPANY", "requests.review": "TEAM" }

    it("sees any, decides and deletes their team's", async () => {
        onRole(grants)
        expect((await view("r-loner")).status).toBe(200)
        expect((await decide("r-emp")).status).toBe(200)
        expect((await remove("r-emp")).status).toBe(200)
    })

    it("does not decide or delete another's in the company", async () => {
        onRole(grants)
        expect((await decide("r-loner")).status).toBe(403)
        expect((await remove("r-loner")).status).toBe(403)
    })
})

describe("a team-scoped request reviewer who sees every person", () => {
    it("is held to the team by the requests permission, not by employees.view", async () => {
        onRole({ "requests.view": "TEAM", "requests.review": "TEAM", "employees.view": "COMPANY" })
        expect((await view("r-loner")).status).toBe(403)
        expect((await decide("r-loner")).status).toBe(403)
        expect((await view("r-emp")).status).toBe(200)
    })
})
