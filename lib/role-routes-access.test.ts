import { describe, it, expect, vi, beforeEach } from "vitest"
import { builtInGrantsToken } from "@/lib/permissions/built-in"
import { encodeGrants } from "@/lib/permissions/grants"

/**
 * Who may manage roles and role templates (ROLES_PLAN.md §4.1, §6).
 *
 * The Super Admin alone, reads included: a company's roles are how its
 * contract is written. A company Admin holds every permission their company's
 * package allows and still may not see or change the roles themselves — the
 * services behind these routes are mocked here, so what is tested is the gate.
 */

const state = { session: null as any, calls: [] as string[] }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { logSystemError: async () => "ref", friendlyErrorMessage: () => "error", log: async () => {} } }))
vi.mock("@/lib/services/role.service", () => {
    const record = (name: string) => async () => { state.calls.push(`role.${name}`); return {} }
    return {
        GrantsError: class extends Error {},
        RoleService: { accessOf: async () => ({ unrestricted: true, bundles: [] }), copyFrom: record("copyFrom"), setDefault: record("setDefault"), getById: record("getById"), listForCompany: async () => { state.calls.push("role.listForCompany"); return [] }, create: record("create"), update: record("update"), delete: record("delete") },
    }
})
vi.mock("@/lib/prisma", () => ({ prisma: { company: { findUnique: async () => ({ name: "One" }) } } }))
vi.mock("@/lib/services/role-request.service", () => ({
    RoleRequestService: {
        list: async () => { state.calls.push("requests.list"); return [] },
        create: async () => { state.calls.push("requests.create"); return {} },
    },
}))
vi.mock("@/lib/services/access-report.service", () => ({
    AccessReportService: {
        whoCan: async () => { state.calls.push("whoCan"); return {} },
        whatCan: async () => { state.calls.push("whatCan"); return {} },
    },
}))
vi.mock("@/lib/services/role-assignment.service", () => ({
    RoleAssignmentService: { assignable: async (_: any, actor: any, companyId: string) => { state.calls.push(`assignable:${companyId}`); return [] } },
}))
vi.mock("@/lib/services/role-template.service", () => {
    const record = (name: string) => async () => { state.calls.push(`template.${name}`); return {} }
    return { RoleTemplateService: { offers: record("offers"), applyTo: record("applyTo"), list: record("list"), getById: record("getById"), create: record("create"), update: record("update"), delete: record("delete") } }
})

const ROLE_BODY = { companyId: "c1", name: "Accountant", description: null, baseRole: "EMPLOYEE", grants: [] }
const TEMPLATE_BODY = { name: "Accountant", description: null, baseRole: "EMPLOYEE", grants: [] }

type Call = { route: "roles" | "role-templates" | "roles/default" | "roles/who-can" | "roles/copy" | "role-templates/push" | "roles/export"; method: "GET" | "POST" | "PUT" | "DELETE"; query?: string; body?: any }

const CALLS: Call[] = [
    { route: "roles", method: "GET", query: "?companyId=c1" },
    { route: "roles", method: "GET", query: "?id=r1" },
    { route: "roles", method: "POST", body: ROLE_BODY },
    { route: "roles", method: "PUT", body: { id: "r1", name: "Accountant" } },
    { route: "roles", method: "DELETE", query: "?id=r1" },
    { route: "role-templates", method: "GET" },
    { route: "role-templates", method: "POST", body: TEMPLATE_BODY },
    { route: "role-templates", method: "PUT", body: { id: "t1", name: "Accountant" } },
    { route: "role-templates", method: "DELETE", query: "?id=t1" },
    { route: "roles/default", method: "PUT", body: { companyId: "c1", roleId: "r1" } },
    { route: "roles/who-can", method: "GET", query: "?companyId=c1&permission=payroll.approve" },
    { route: "roles/who-can", method: "GET", query: "?userId=u1" },
    { route: "roles/copy", method: "POST", body: { targetCompanyId: "c1", sourceCompanyId: "c2" } },
    { route: "role-templates/push", method: "GET", query: "?id=t1" },
    { route: "role-templates/push", method: "POST", body: { templateId: "t1", roleIds: ["r1"] } },
    { route: "roles/export", method: "GET", query: "?companyId=c1" },
]

async function send({ route, method, query = "", body }: Call) {
    const handlers: any = route === "roles" ? await import("@/app/api/roles/route")
        : route === "roles/default" ? await import("@/app/api/roles/default/route")
        : route === "roles/who-can" ? await import("@/app/api/roles/who-can/route")
        : route === "roles/copy" ? await import("@/app/api/roles/copy/route")
        : route === "roles/export" ? await import("@/app/api/roles/export/route")
        : route === "role-templates/push" ? await import("@/app/api/role-templates/push/route")
        : await import("@/app/api/role-templates/route")
    const init: RequestInit = { method, headers: { "content-type": "application/json" } }
    if (body) init.body = JSON.stringify(body)
    return handlers[method](new Request(`https://nizmo.test/api/${route}${query}`, init))
}

const label = (c: Call) => `${c.method} /api/${c.route}${c.query ?? ""}`

beforeEach(() => { state.session = null; state.calls = [] })

describe("managing roles and templates", () => {
    it.each(CALLS.map(c => [label(c), c] as const))("the Super Admin may: %s", async (_, call) => {
        state.session = { user: { id: "sa", role: "SUPER_ADMIN" } }
        expect((await send(call)).status).toBeLessThan(300)
        expect(state.calls).toHaveLength(1)
    })

    // An Admin holding everything still may not: it is who they are, not
    // what their role holds, that decides.
    it.each(CALLS.map(c => [label(c), c] as const))("a company Admin may not: %s", async (_, call) => {
        state.session = { user: { id: "a", role: "ADMIN", companyId: "c1", grants: "ALL" } }
        expect((await send(call)).status).toBe(403)
        expect(state.calls).toEqual([])
    })

    it.each(CALLS.map(c => [label(c), c] as const))("an employee may not: %s", async (_, call) => {
        state.session = { user: { id: "e", role: "EMPLOYEE", companyId: "c1", grants: "" } }
        expect((await send(call)).status).toBe(403)
        expect(state.calls).toEqual([])
    })

    it.each(CALLS.map(c => [label(c), c] as const))("nobody signed in may not: %s", async (_, call) => {
        expect((await send(call)).status).toBe(401)
        expect(state.calls).toEqual([])
    })
})

/**
 * The roles somebody may hand out, for a Role dropdown: whoever holds
 * employees.assign_role, in their own company. Which roles, the service
 * decides (lib/roles.db.test.ts).
 */
describe("listing the roles one may hand out", () => {
    const list = async (query = "") => (await import("@/app/api/roles/assignable/route")).GET(new Request(`https://nizmo.test/api/roles/assignable${query}`))

    it("an Admin may, for their own company, whatever company they name", async () => {
        state.session = { user: { id: "a", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN") } }
        expect((await list("?companyId=c2")).status).toBe(200)
        expect(state.calls).toEqual(["assignable:c1"])
    })

    it("the Super Admin may, for the company they name", async () => {
        state.session = { user: { id: "sa", role: "SUPER_ADMIN" } }
        expect((await list("?companyId=c2")).status).toBe(200)
        expect(state.calls).toEqual(["assignable:c2"])
        expect((await list()).status).toBe(400)
    })

    it.each(["TEAM_LEADER", "EMPLOYEE"] as const)("a %s may not", async role => {
        state.session = { user: { id: "x", role, companyId: "c1", grants: builtInGrantsToken(role) } }
        expect((await list()).status).toBe(403)
        expect(state.calls).toEqual([])
    })
})

/**
 * Role requests (ROLES_PLAN.md §6.12): asked for by whoever holds
 * employees.request_role — HR — and listed for them and for whoever decides.
 * Who may decide which request is the service's (lib/roles.db.test.ts).
 */
describe("role requests", () => {
    const hrGrants = encodeGrants({ "employees.view": "COMPANY", "employees.request_role": "COMPANY" })
    const hr = { id: "hr", role: "EMPLOYEE", companyId: "c1", grants: hrGrants }
    const requests = () => import("@/app/api/role-requests/route")
    const ask = async () => (await requests()).POST(new Request("https://nizmo.test/api/role-requests", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "e", roleId: "r1" }),
    }))
    const list = async () => (await requests()).GET(new Request("https://nizmo.test/api/role-requests"))
    const assignable = async () => (await import("@/app/api/roles/assignable/route")).GET(new Request("https://nizmo.test/api/roles/assignable"))

    it("HR may ask, see their requests, and see what they could ask for", async () => {
        state.session = { user: hr }
        expect((await ask()).status).toBe(201)
        expect((await list()).status).toBe(200)
        expect((await assignable()).status).toBe(200)
        expect(state.calls).toEqual(["requests.create", "requests.list", "assignable:c1"])
    })

    // The built-in Admin gives roles directly; asking is for those who cannot.
    it("an Admin sees the requests but does not ask", async () => {
        state.session = { user: { id: "a", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN") } }
        expect((await list()).status).toBe(200)
        expect((await ask()).status).toBe(403)
        expect(state.calls).toEqual(["requests.list"])
    })

    it("an employee may do neither", async () => {
        state.session = { user: { id: "x", role: "EMPLOYEE", companyId: "c1", grants: builtInGrantsToken("EMPLOYEE") } }
        expect((await ask()).status).toBe(403)
        expect((await list()).status).toBe(403)
        expect(state.calls).toEqual([])
    })
})
