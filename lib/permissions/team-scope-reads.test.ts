import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, url } from "./employee-access.harness"
import { encodeGrants, type Grants } from "./grants"
import { stepUpConfirmed } from "./test-actors"
import { permissionsOf } from "@/lib/useCan"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Reading one person's records with a grant held for a team: salaries and
 * adjustments (salary.view), leave history (dayoff.view) and the employment
 * record (employees.edit). A team-scoped grant reaches the team, not the
 * company. The built-in roles never held these at team scope; custom roles can.
 *
 * The actor is the harness's Team Leader ("tl"), whose team is "emp"; "loner"
 * is in the company but not the team. They hold employees.view company-wide,
 * so the company check's own team rule (employees.view's) lets both through,
 * and only the permission's own scope can tell them apart.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/salary.service", () => ({ SalaryService: { getAdjustments: async () => [], ensureRecordsThrough: async () => {}, historyWithPayslips: async () => [] } }))
vi.mock("@/lib/services/user.service", () => ({ UserService: { getDayOffHistory: async () => [] } }))
vi.mock("@/lib/services/employment.service", () => ({ EmploymentService: { history: async () => [], timelineForMonth: async () => [] } }))
vi.mock("@/lib/services/settlement.service", () => ({ SettlementService: { preview: async () => ({}) } }))

function onRole(grants: Grants) {
    state.session = { user: stepUpConfirmed({ id: "tl", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY", ...grants }) }) }
}

const get = (path: string) => new Request(url(path))
const context = (id: string) => ({ params: Promise.resolve({ id }) })

const ROUTES = [
    { name: "salary history", grant: { "salary.view": "TEAM" }, run: async (id: string) => (await import("@/app/api/users/[id]/salary-history/route")).GET(get(`/api/users/${id}/salary-history`), context(id)) },
    { name: "salary adjustments", grant: { "salary.view": "TEAM" }, run: async (id: string) => (await import("@/app/api/users/[id]/adjustments/route")).GET(get(`/api/users/${id}/adjustments`), context(id)) },
    { name: "leave history", grant: { "dayoff.view": "TEAM" }, run: async (id: string) => (await import("@/app/api/users/[id]/day-off-history/route")).GET(get(`/api/users/${id}/day-off-history`), context(id)) },
    { name: "the employment record", grant: { "employees.edit": "TEAM" }, run: async (id: string) => (await import("@/app/api/users/[id]/employment/route")).GET(get(`/api/users/${id}/employment`), context(id)) },
] as const

describe("a grant held for a team", () => {
    for (const route of ROUTES) {
        it(`reads ${route.name} of the team`, async () => {
            onRole(route.grant as Grants)
            expect((await route.run("emp")).status).toBe(200)
        })

        it(`does not read ${route.name} of the rest of the company`, async () => {
            onRole(route.grant as Grants)
            expect((await route.run("loner")).status).toBe(403)
        })
    }
})

describe("the leave requests list", () => {
    async function listedWhere(grants: Grants) {
        onRole(grants)
        let where: any = null
        prismaMock.dayOffRequest.findMany = async (args: any) => { where = args.where; return [] }
        const { GET } = await import("@/app/api/admin/day-off-requests/route")
        expect((await GET(get("/api/admin/day-off-requests"))).status).toBe(200)
        return where
    }

    it("held for a team, lists the team's requests and one's own", async () => {
        expect(await listedWhere({ "dayoff.view": "TEAM" })).toEqual({ user: { companyId: "c1", OR: [{ teamLeaderId: "tl" }, { id: "tl" }] } })
    })

    it("held for the company, lists the company's", async () => {
        expect(await listedWhere({ "dayoff.view": "COMPANY" })).toEqual({ user: { companyId: "c1" } })
    })
})

describe("a screen asking about somebody (canFor)", () => {
    const approver = permissionsOf({ id: "tl", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "dayoff.approve": "TEAM" }) })

    it("offers a team-scoped approver their team's requests", () => {
        expect(approver.canFor("dayoff.approve", "emp", "tl")).toBe(true)
    })

    it("and not the rest of the company's, nor their own", () => {
        expect(approver.canFor("dayoff.approve", "loner", null)).toBe(false)
        expect(approver.canFor("dayoff.approve", "tl", null)).toBe(false)
    })
})
