import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who sees derived days, and their money (ATTENDANCE_PLAN.md §11, §13.3):
 * everyone their own; attendance.view_team others' at its scope. What a day
 * cost is a share of that person's salary, so it reaches only the person and
 * those whose salary.view covers them. Rebuilding a month is for whoever
 * corrects the whole company. The engine is replaced; who reaches it is checked.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const reached: string[] = []
const DAYS = [
    { id: "d1", userId: "emp", teamLeaderId: "tl", name: "Emp", date: "2026-09-08", deductionMinor: 31000, overtimeMinor: 0 },
    { id: "d2", userId: "hr", teamLeaderId: null, name: "Hr", date: "2026-09-08", deductionMinor: 15500, overtimeMinor: 0 },
]
vi.mock("@/lib/services/attendance-engine.service", () => ({
    DAY_LIST_LIMIT: 3000,
    AttendanceEngineService: {
        days: async (companyId: string, q: any, visible: any, limit: number) => {
            reached.push(`days:${companyId}:${visible.kind}`)
            return q.userId === "busy" ? Array.from({ length: limit }, (_, i) => ({ ...DAYS[0], id: `d${i}` })) : DAYS.map(d => ({ ...d }))
        },
        recomputeMonth: async (companyId: string, month: string) => { reached.push(`recompute:${companyId}:${month}`); return { month, locked: false, derived: 0, written: 0, removed: 0 } },
    },
}))

vi.mock("@/lib/services/attendance-policy.service", async () => {
    const { STANDARD_OFFICE } = await import("@/lib/attendance/policy")
    return { AttendancePolicyService: { versions: async () => [{ id: "p1", effectiveFrom: "2026-09-01", body: STANDARD_OFFICE }] } }
})

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
const ATTENDANCE: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceMobile: true }

beforeEach(() => {
    reached.length = 0
    prismaMock.company.findUnique = async ({ where }: any) => where.id === "c1" ? { id: "c1", adminSettingsEnabled: false, adminSettingsTabs: [], package: ATTENDANCE } : null
})

function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }) {
    state.session = { user: stepUpConfirmed({ ...user, grants: user.grants ? encodeGrants(user.grants as any) : undefined, featureAccess: serializeAccess(resolveBundles(ATTENDANCE, { isSuperAdmin: user.role === "SUPER_ADMIN" })) }) }
}
const admin = () => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN })
const employee = () => signIn({ id: "emp", role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE })
const attendanceOnly = () => signIn({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: { "attendance.view_team": "COMPANY", "attendance.correct": "COMPANY" } })

const days = async (query = "from=2026-09-01&to=2026-09-30") => (await import("@/app/api/attendance/days/route")).GET(new Request(url(`/api/attendance/days?${query}`)))
const recompute = async (body: unknown) => (await import("@/app/api/attendance/recompute/route")).POST(withBody("POST", "/api/attendance/recompute", body))
const money = async (res: Response) => ((await res.json()).data.days as any[]).map(d => [d.userId, d.deductionMinor])

describe("derived days", () => {
    it("show an Admin everyone's, with the money, since their salary.view covers the company", async () => {
        admin()
        expect(await money(await days())).toEqual([["emp", 31000], ["hr", 15500]])
        expect(reached).toEqual(["days:c1:COMPANY"])
    })

    it("show a role that keeps attendance but not salaries the minutes and not other people's money", async () => {
        attendanceOnly()
        expect(await money(await days())).toEqual([["emp", null], ["hr", 15500]])
    })

    it("are an employee's own, asked through their own visibility", async () => {
        employee()
        expect((await days()).status).toBe(200)
        expect(reached).toEqual(["days:c1:OWN"])
    })

    it("ask for real dates, in order, at most two months", async () => {
        admin()
        expect((await days("from=2026-09-30&to=2026-09-01")).status).toBe(400)
        expect((await days("from=2026-01-01&to=2026-12-31")).status).toBe(400)
        expect(reached).toEqual([])
    })
})

describe("the month's rules (§13.3)", () => {
    it("come with the days: how many lates and early leaves the period's policy lets go free", async () => {
        employee()
        const res = await days()
        expect((await res.json()).data.rules).toEqual({ lateness: { enabled: true, freePerMonth: 2 }, earlyLeave: { enabled: true, freePerMonth: 0 } })
    })
})

describe("rebuilding a month", () => {
    it("is for whoever corrects the company's attendance, and takes a month", async () => {
        admin()
        expect((await recompute({ month: "2026-09" })).status).toBe(200)
        expect((await recompute({ month: "September" })).status).toBe(400)
        attendanceOnly()
        expect((await recompute({ month: "2026-09" })).status).toBe(200)
        employee()
        expect((await recompute({ month: "2026-09" })).status).toBe(403)
        expect(reached).toEqual(["recompute:c1:2026-09", "recompute:c1:2026-09"])
    })
})

describe("a long list of days (review on #13)", () => {
    it("says it stopped short, so nobody reads a partial total as the month's", async () => {
        admin()
        const full = await (await days("from=2026-09-01&to=2026-09-30&userId=busy")).json()
        expect(full.data).toMatchObject({ truncated: true, limit: 3000 })
        expect(full.data.days).toHaveLength(3000)
        expect((await (await days()).json()).data.truncated).toBe(false)
    })
})
