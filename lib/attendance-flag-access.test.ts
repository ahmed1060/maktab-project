import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who decides flagged check-ins (ATTENDANCE_PLAN.md §9.6): the company's
 * reviewers — attendance.correct, at its scope, never their own — decide
 * the company's; the Super Admin decides any, and alone those flagged
 * because our app couldn't prove itself. The service is replaced.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const reached: string[] = []
const PUNCHES: Record<string, any> = {
    "f-company": { id: "f-company", companyId: "c1", userId: "e1", status: "FLAGGED", flagReasons: ["OUTSIDE_AREA"], user: { teamLeaderId: "lead" } },
    "f-platform": { id: "f-platform", companyId: "c1", userId: "e1", status: "FLAGGED", flagReasons: ["OUTSIDE_AREA", "ATTESTATION_UNVERIFIED"], user: { teamLeaderId: "lead" } },
    "f-other-team": { id: "f-other-team", companyId: "c1", userId: "e2", status: "FLAGGED", flagReasons: ["OUTSIDE_AREA"], user: { teamLeaderId: null } },
    "f-own": { id: "f-own", companyId: "c1", userId: "admin", status: "FLAGGED", flagReasons: ["OUTSIDE_AREA"], user: { teamLeaderId: null } },
    "f-c2": { id: "f-c2", companyId: "c2", userId: "x", status: "FLAGGED", flagReasons: ["OUTSIDE_AREA"], user: { teamLeaderId: null } },
}
vi.mock("@/lib/services/attendance-flag.service", () => ({
    AttendanceFlagService: {
        list: async (reviewer: string, scope: any) => { reached.push(`list:${reviewer}:${scope === "ALL" ? "ALL" : `${scope.companyId}:${scope.visible.kind}`}`); return [] },
        flaggedOf: async (id: string) => PUNCHES[id] ?? null,
        reviewerOf: (reasons: string[]) => (reasons.includes("ATTESTATION_UNVERIFIED") ? "PLATFORM" : "COMPANY"),
        decide: async (id: string, d: any) => { reached.push(`decide:${id}:${d.accept}`) },
        integrity: async () => { reached.push("integrity"); return [] },
    },
}))

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceMobile?: boolean } | null
const MOBILE: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceMobile: true }
const companies: Record<string, { adminSettingsEnabled: boolean; adminSettingsTabs: string[]; package: Pkg }> = {}

beforeEach(() => {
    reached.length = 0
    companies.c1 = { adminSettingsEnabled: false, adminSettingsTabs: [], package: MOBILE }
    companies.c2 = { adminSettingsEnabled: false, adminSettingsTabs: [], package: MOBILE }
    prismaMock.company.findUnique = async ({ where }: any) => companies[where.id] ? { id: where.id, ...companies[where.id] } : null
})

function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }) {
    state.session = {
        user: stepUpConfirmed({
            ...user,
            grants: user.grants ? encodeGrants(user.grants as any) : undefined,
            featureAccess: serializeAccess(resolveBundles(MOBILE, { isSuperAdmin: user.role === "SUPER_ADMIN" })),
        }),
    }
}
const admin = () => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN })
const lead = () => signIn({ id: "lead", role: "EMPLOYEE", companyId: "c1", grants: { "attendance.correct": "TEAM" } })
const employee = () => signIn({ id: "e1", role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE })
const superAdmin = () => signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })

const params = (id: string) => ({ params: Promise.resolve({ id }) }) as any
const list = async (query = "") => (await import("@/app/api/attendance/flagged/route")).GET(new Request(url(`/api/attendance/flagged${query}`)))
const decide = async (id: string, body: unknown) => (await import("@/app/api/attendance/flagged/[id]/decide/route")).POST(withBody("POST", `/api/attendance/flagged/${id}/decide`, body), params(id))
const review = async () => (await import("@/app/api/admin/check-ins/route")).GET(new Request(url("/api/admin/check-ins")))

describe("the company's flagged check-ins", () => {
    it("are listed and decided by the company's Admin, but not those waiting for the Super Admin, nor their own", async () => {
        admin()
        expect((await list()).status).toBe(200)
        expect((await decide("f-company", { accept: true })).status).toBe(200)
        expect((await decide("f-platform", { accept: true })).status).toBe(403)
        expect((await decide("f-own", { accept: true })).status).toBe(403)
        expect(reached).toEqual(["list:COMPANY:c1:COMPANY", "decide:f-company:true"])
    })

    it("are decided by a team leader with correction at team scope, for their team only", async () => {
        lead()
        expect((await list()).status).toBe(200)
        expect((await decide("f-company", { accept: false, reason: "Not on site" })).status).toBe(200)
        expect((await decide("f-other-team", { accept: true })).status).toBe(403)
        expect(reached).toEqual(["list:COMPANY:c1:TEAM", "decide:f-company:false"])
    })

    it("are nothing an employee decides; another company's is as if absent; a bad body is refused", async () => {
        employee()
        expect((await list()).status).toBe(403)
        expect((await decide("f-company", { accept: true })).status).toBe(403)
        admin()
        expect((await decide("f-c2", { accept: true })).status).toBe(404)
        expect((await decide("nope", { accept: true })).status).toBe(404)
        expect((await decide("f-company", { accept: "yes" })).status).toBe(400)
        expect(reached).toEqual([])
    })
})

describe("the Super Admin's review", () => {
    it("lists what waits for them with the integrity view, and decides any check-in", async () => {
        superAdmin()
        expect((await review()).status).toBe(200)
        expect((await decide("f-platform", { accept: false })).status).toBe(200)
        expect((await decide("f-c2", { accept: true })).status).toBe(200)
        expect(reached).toEqual(["list:PLATFORM:ALL", "integrity", "decide:f-platform:false", "decide:f-c2:true"])
    })

    it("is the Super Admin's alone", async () => {
        admin()
        expect((await review()).status).toBe(403)
        expect(reached).toEqual([])
    })
})
