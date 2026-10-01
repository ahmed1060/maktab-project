import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who may ask and who may decide (P0.6). Everyone asks for themselves:
 * permission hours, a missing punch. Deciding is attendance.approve_permissions,
 * attendance.approve_overtime and attendance.correct, at their scope — never
 * on one's own. The company must hold attendance. The service is replaced;
 * what is checked is who reaches it.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const reached: string[] = []
const record = (id: string, userId: string, companyId = "c1", teamLeaderId: string | null = null) => ({ id, companyId, userId, user: { teamLeaderId } })
const REQUESTS: Record<string, any> = {
    r1: record("r1", "emp", "c1", "tl"),
    rOwn: record("rOwn", "admin"),
    rOther: record("rOther", "other", "c2"),
}
vi.mock("@/lib/services/attendance-request.service", () => ({
    AttendanceRequestService: {
        todayIn: async () => "2026-10-20",
        permissions: async (companyId: string, _q: any, visible: any) => { reached.push(`permissions:${companyId}:${visible.kind}`); return [] },
        requestPermission: async (companyId: string, userId: string) => { reached.push(`ask:${companyId}:${userId}`); return { id: "new" } },
        permissionBalance: async (companyId: string, userId: string, month: string, date?: string | null) => { reached.push(`balance:${companyId}:${userId}:${month}${date ? `:${date}` : ""}`); return {} },
        permissionOf: async (id: string) => REQUESTS[id] ?? null,
        cancelPermission: async (id: string, userId: string) => { reached.push(`cancel:${id}:${userId}`) },
        decidePermission: async (id: string, d: any) => { reached.push(`decide:${id}:${d.approve}`) },
        missingPunches: async (companyId: string, _q: any, visible: any) => { reached.push(`missing:${companyId}:${visible.kind}`); return [] },
        reportMissingPunch: async (companyId: string, userId: string) => { reached.push(`report:${companyId}:${userId}`); return { id: "new" } },
        missingPunchOf: async (id: string) => REQUESTS[id] ?? null,
        cancelMissingPunch: async (id: string, userId: string) => { reached.push(`cancelMissing:${id}:${userId}`) },
        decideMissingPunch: async (id: string, d: any) => { reached.push(`decideMissing:${id}:${d.approve}`) },
        overtime: async (companyId: string, _q: any, visible: any) => { reached.push(`overtime:${companyId}:${visible.kind}`); return { waiting: [], decisions: [] } },
        decideOvertime: async (companyId: string, input: any) => { reached.push(`overtime:${companyId}:${input.userId}:${input.status}`); return {} },
        decisionOf: async (id: string) => REQUESTS[id] ?? null,
        withdrawOvertime: async (id: string) => { reached.push(`withdraw:${id}`) },
    },
}))

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean } | null
const ATTENDANCE: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: true }
const HR_ONLY: Pkg = { hasCompanyManagement: false, hasHR: true }
const packages: Record<string, Pkg> = {}
const people: Record<string, { id: string; companyId: string; teamLeaderId: string | null }> = {
    emp: { id: "emp", companyId: "c1", teamLeaderId: "tl" },
    loner: { id: "loner", companyId: "c1", teamLeaderId: null },
    admin: { id: "admin", companyId: "c1", teamLeaderId: null },
    other: { id: "other", companyId: "c2", teamLeaderId: null },
}

beforeEach(() => {
    reached.length = 0
    packages.c1 = ATTENDANCE
    packages.c2 = ATTENDANCE
    packages.c3 = HR_ONLY
    prismaMock.company.findUnique = async ({ where }: any) => where.id in packages
        ? { id: where.id, adminSettingsEnabled: false, adminSettingsTabs: [], package: packages[where.id] } : null
    ;(prismaMock as any).user.findFirst = async ({ where }: any) => {
        const p = people[where.id]
        return p && p.companyId === where.companyId ? p : null
    }
})

function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }, pkg: Pkg = ATTENDANCE) {
    state.session = {
        user: stepUpConfirmed({
            ...user,
            grants: user.grants ? encodeGrants(user.grants as any) : undefined,
            featureAccess: serializeAccess(resolveBundles(pkg, { isSuperAdmin: user.role === "SUPER_ADMIN" })),
        }),
    }
}
const admin = (pkg: Pkg = ATTENDANCE) => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN }, pkg)
const employee = () => signIn({ id: "emp", role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE })
const leader = () => signIn({ id: "tl", role: "EMPLOYEE", companyId: "c1", grants: {
    "attendance.approve_permissions": "TEAM", "attendance.approve_overtime": "TEAM", "attendance.correct": "TEAM",
} })
const superAdmin = () => signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })

const params = (id: string) => ({ params: Promise.resolve({ id }) }) as any
const PERMISSION = { date: "2026-10-21", type: "MIDDAY", start: "12:00", end: "13:00", reason: "Errand" }
const MISSING = { at: "2026-10-15T17:00", direction: "OUT", reason: "Forgot" }

const permissions = async (query = "") => (await import("@/app/api/attendance/permissions/route")).GET(new Request(url(`/api/attendance/permissions${query}`)))
const ask = async (body: unknown = PERMISSION) => (await import("@/app/api/attendance/permissions/route")).POST(withBody("POST", "/api/attendance/permissions", body))
const balance = async (query = "") => (await import("@/app/api/attendance/permissions/balance/route")).GET(new Request(url(`/api/attendance/permissions/balance${query}`)))
const cancel = async (id: string) => (await import("@/app/api/attendance/permissions/[id]/route")).DELETE(withBody("DELETE", `/api/attendance/permissions/${id}`, {}), params(id))
const decide = async (id: string, approve = true) =>
    (await import("@/app/api/attendance/permissions/[id]/decide/route")).POST(withBody("POST", `/api/attendance/permissions/${id}/decide`, { approve }), params(id))
const missing = async (query = "") => (await import("@/app/api/attendance/missing-punches/route")).GET(new Request(url(`/api/attendance/missing-punches${query}`)))
const report = async (body: unknown = MISSING) => (await import("@/app/api/attendance/missing-punches/route")).POST(withBody("POST", "/api/attendance/missing-punches", body))
const decideMissing = async (id: string, approve = true) =>
    (await import("@/app/api/attendance/missing-punches/[id]/decide/route")).POST(withBody("POST", `/api/attendance/missing-punches/${id}/decide`, { approve }), params(id))
const overtime = async (query = "from=2026-10-01&to=2026-10-31") => (await import("@/app/api/attendance/overtime/route")).GET(new Request(url(`/api/attendance/overtime?${query}`)))
const decideOvertime = async (userId: string, extra: Record<string, unknown> = {}) =>
    (await import("@/app/api/attendance/overtime/route")).POST(withBody("POST", "/api/attendance/overtime", { userId, date: "2026-10-18", status: "APPROVED", ...extra }))
const withdraw = async (id: string) => (await import("@/app/api/attendance/overtime/[id]/route")).DELETE(withBody("DELETE", `/api/attendance/overtime/${id}`, {}), params(id))

describe("asking for oneself", () => {
    it("is everybody's in a company with attendance: permission hours, the balance, a missing punch", async () => {
        employee()
        expect((await ask()).status).toBe(201)
        expect((await balance()).status).toBe(200)
        // For the day a request would be for: that day's month and policy (review on #14).
        expect((await balance("?date=2026-11-03")).status).toBe(200)
        expect((await report()).status).toBe(201)
        expect((await permissions("?mine=1")).status).toBe(200)
        expect((await missing("?mine=1")).status).toBe(200)
        expect((await cancel("r1")).status).toBe(200)
        expect(reached).toEqual(["ask:c1:emp", "balance:c1:emp:2026-10", "balance:c1:emp:2026-11:2026-11-03", "report:c1:emp", "permissions:c1:OWN", "missing:c1:OWN", "cancel:r1:emp"])
    })

    it("is nobody's in a company without attendance, and not the Super Admin's, who has none", async () => {
        admin(HR_ONLY)
        expect((await ask()).status).toBe(403)
        expect((await report()).status).toBe(403)
        superAdmin()
        expect((await ask()).status).toBe(403)
        expect((await report()).status).toBe(403)
        expect(reached).toEqual([])
    })

    it("refuses a body that isn't a request", async () => {
        employee()
        expect((await ask({ ...PERMISSION, type: "LUNCH" })).status).toBe(400)
        expect((await ask({ ...PERMISSION, start: "noon" })).status).toBe(400)
        expect((await report({ ...MISSING, at: "yesterday" })).status).toBe(400)
        expect(reached).toEqual([])
    })
})

describe("deciding", () => {
    it("is the Admin's, company-wide, for all three kinds", async () => {
        admin()
        expect((await permissions()).status).toBe(200)
        expect((await decide("r1")).status).toBe(200)
        expect((await missing()).status).toBe(200)
        expect((await decideMissing("r1", false)).status).toBe(200)
        expect((await overtime()).status).toBe(200)
        expect((await decideOvertime("emp")).status).toBe(200)
        expect((await withdraw("r1")).status).toBe(200)
        expect(reached).toEqual(["permissions:c1:COMPANY", "decide:r1:true", "missing:c1:COMPANY", "decideMissing:r1:false", "overtime:c1:COMPANY", "overtime:c1:emp:APPROVED", "withdraw:r1"])
    })

    it("is a team leader's for their team only", async () => {
        leader()
        expect((await permissions()).status).toBe(200)
        expect((await decide("r1")).status).toBe(200)
        expect((await decideOvertime("emp")).status).toBe(200)
        expect((await decideOvertime("loner")).status).toBe(403)
        expect((await decideMissing("rOwn")).status).toBe(403)
        expect(reached).toEqual(["permissions:c1:TEAM", "decide:r1:true", "overtime:c1:emp:APPROVED"])
    })

    it("is never anybody's on their own requests, the Admin's included", async () => {
        admin()
        expect((await decide("rOwn")).status).toBe(403)
        expect((await decideMissing("rOwn")).status).toBe(403)
        expect((await decideOvertime("admin")).status).toBe(403)
        expect((await withdraw("rOwn")).status).toBe(403)
        expect(reached).toEqual([])
    })

    it("is not an employee's, and never reaches into another company", async () => {
        employee()
        expect((await permissions()).status).toBe(403)
        expect((await missing()).status).toBe(403)
        expect((await overtime()).status).toBe(403)
        expect((await decide("r1")).status).toBe(403)
        admin()
        expect((await decide("rOther")).status).toBe(404)
        expect((await decideMissing("rOther")).status).toBe(404)
        expect((await withdraw("rOther")).status).toBe(404)
        expect((await decideOvertime("other")).status).toBe(404)
        expect((await decide("nope")).status).toBe(404)
        expect(reached).toEqual([])
    })

    it("lets the Super Admin decide in a company holding attendance, and only there", async () => {
        superAdmin()
        expect((await decide("r1")).status).toBe(200)
        expect((await decideOvertime("emp", { companyId: "c1" })).status).toBe(200)
        expect((await decideOvertime("emp", { companyId: "c3" })).status).toBe(404)
        expect(reached).toEqual(["decide:r1:true", "overtime:c1:emp:APPROVED"])
    })
})
