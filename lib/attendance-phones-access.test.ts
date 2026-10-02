import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who reaches check-in phones (ATTENDANCE_PLAN.md §9.2, §9.3, §16). A person
 * registers, sees and withdraws their own, in a company holding the Mobile
 * App add-on. Whoever holds attendance.approve_devices decides others' —
 * the company's, or their team's — and never their own. The services are
 * replaced; what is checked here is who reaches them.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const reached: string[] = []
const PHONES: Record<string, any> = {
    "ph-e1": { id: "ph-e1", companyId: "c1", userId: "e1", status: "PENDING", user: { teamLeaderId: "lead" } },
    "ph-e2": { id: "ph-e2", companyId: "c1", userId: "e2", status: "PENDING", user: { teamLeaderId: null } },
    "ph-admin": { id: "ph-admin", companyId: "c1", userId: "admin", status: "PENDING", user: { teamLeaderId: null } },
    "ph-other": { id: "ph-other", companyId: "c2", userId: "x", status: "PENDING", user: { teamLeaderId: null } },
}
vi.mock("@/lib/services/attendance-phone.service", () => ({
    AttendancePhoneService: {
        register: async (companyId: string, userId: string) => { reached.push(`register:${companyId}:${userId}`); return { id: "new" } },
        mine: async (userId: string) => { reached.push(`mine:${userId}`); return { active: null, pending: null } },
        withdraw: async (userId: string) => { reached.push(`withdraw:${userId}`); return {} },
        list: async (companyId: string, visible: any) => { reached.push(`list:${companyId}:${visible.kind}`); return [] },
        phoneOf: async (id: string) => PHONES[id] ?? null,
        decide: async (id: string, d: any) => { reached.push(`decide:${id}:${d.approve}`) },
        revoke: async (id: string) => { reached.push(`revoke:${id}`) },
    },
}))
vi.mock("@/lib/services/attendance-challenge.service", () => ({
    AttendanceChallengeService: { issue: async (userId: string, purpose: string) => { reached.push(`challenge:${userId}:${purpose}`); return { nonce: "n", expiresAt: new Date() } } },
}))

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
const MOBILE: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceMobile: true }
const TERMINALS_ONLY: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: true }
const companies: Record<string, { adminSettingsEnabled: boolean; adminSettingsTabs: string[]; package: Pkg }> = {}

beforeEach(() => {
    reached.length = 0
    companies.c1 = { adminSettingsEnabled: false, adminSettingsTabs: [], package: MOBILE }
    companies.c2 = { adminSettingsEnabled: false, adminSettingsTabs: [], package: MOBILE }
    prismaMock.company.findUnique = async ({ where }: any) => companies[where.id] ? { id: where.id, ...companies[where.id] } : null
})

function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }, pkg: Pkg = MOBILE) {
    state.session = {
        user: stepUpConfirmed({
            ...user,
            grants: user.grants ? encodeGrants(user.grants as any) : undefined,
            featureAccess: serializeAccess(resolveBundles(pkg, { isSuperAdmin: user.role === "SUPER_ADMIN" })),
        }),
    }
}
const admin = () => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN })
const lead = () => signIn({ id: "lead", role: "EMPLOYEE", companyId: "c1", grants: { "attendance.approve_devices": "TEAM" } })
const employee = (id = "e1", pkg: Pkg = MOBILE) => signIn({ id, role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE }, pkg)
const superAdmin = () => signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })

const REGISTER = { nonce: "n".repeat(43), publicKey: "AAAA", signature: "BBBB", platform: "ANDROID" }
const params = (id: string) => ({ params: Promise.resolve({ id }) }) as any
const challenge = async (body: unknown) => (await import("@/app/api/attendance/phone/challenge/route")).POST(withBody("POST", "/api/attendance/phone/challenge", body))
const register = async (body: unknown) => (await import("@/app/api/attendance/phone/register/route")).POST(withBody("POST", "/api/attendance/phone/register", body))
const mine = async () => (await import("@/app/api/attendance/phone/route")).GET(new Request(url("/api/attendance/phone")))
const withdraw = async () => (await import("@/app/api/attendance/phone/route")).DELETE(new Request(url("/api/attendance/phone"), { method: "DELETE" }))
const list = async (query = "") => (await import("@/app/api/attendance/phones/route")).GET(new Request(url(`/api/attendance/phones${query}`)))
const decide = async (id: string, body: unknown) => (await import("@/app/api/attendance/phones/[id]/decide/route")).POST(withBody("POST", `/api/attendance/phones/${id}/decide`, body), params(id))
const revoke = async (id: string) => (await import("@/app/api/attendance/phones/[id]/revoke/route")).POST(withBody("POST", `/api/attendance/phones/${id}/revoke`, {}), params(id))

describe("one's own phone", () => {
    it("is registered, seen and withdrawn by its owner, with a number to sign first", async () => {
        employee()
        expect((await challenge({ purpose: "REGISTER" })).status).toBe(200)
        expect((await register(REGISTER)).status).toBe(201)
        expect((await mine()).status).toBe(200)
        expect((await withdraw()).status).toBe(200)
        expect(reached).toEqual(["challenge:e1:REGISTER", "register:c1:e1", "mine:e1", "withdraw:e1"])
    })

    it("refuses a body of the wrong shape before reaching anything", async () => {
        employee()
        expect((await challenge({ purpose: "SOMETHING" })).status).toBe(400)
        expect((await register({ ...REGISTER, platform: "SYMBIAN" })).status).toBe(400)
        expect((await register({ ...REGISTER, nonce: "short" })).status).toBe(400)
        expect(reached).toEqual([])
    })

    it("is not there for a company without the Mobile App add-on, nor for the Super Admin, who has no attendance", async () => {
        companies.c1.package = TERMINALS_ONLY
        employee("e1", TERMINALS_ONLY)
        expect((await challenge({ purpose: "REGISTER" })).status).toBe(403)
        expect((await register(REGISTER)).status).toBe(403)
        superAdmin()
        expect((await mine()).status).toBe(404)
        expect(reached).toEqual([])
    })
})

describe("deciding others' phones", () => {
    it("the company's Admin lists, approves and revokes; never their own", async () => {
        admin()
        expect((await list()).status).toBe(200)
        expect((await decide("ph-e1", { approve: true })).status).toBe(200)
        expect((await revoke("ph-e2")).status).toBe(200)
        expect((await decide("ph-admin", { approve: true })).status).toBe(403)
        expect(reached).toEqual(["list:c1:COMPANY", "decide:ph-e1:true", "revoke:ph-e2"])
    })

    it("a team leader with the team scope decides their team's, and only theirs", async () => {
        lead()
        expect((await list()).status).toBe(200)
        expect((await decide("ph-e1", { approve: false, reason: "Not yours" })).status).toBe(200)
        expect((await decide("ph-e2", { approve: true })).status).toBe(403)
        expect(reached).toEqual(["list:c1:TEAM", "decide:ph-e1:false"])
    })

    it("an employee decides nothing, and another company's phone is as if absent", async () => {
        employee("e2")
        expect((await list()).status).toBe(403)
        expect((await decide("ph-e1", { approve: true })).status).toBe(403)
        admin()
        expect((await decide("ph-other", { approve: true })).status).toBe(404)
        expect((await revoke("nope")).status).toBe(404)
        expect((await decide("ph-e1", { approve: "yes" })).status).toBe(400)
        expect(reached).toEqual([])
    })

    it("the Super Admin decides for a company they name", async () => {
        superAdmin()
        expect((await list("?companyId=c2")).status).toBe(200)
        expect((await decide("ph-other", { approve: true })).status).toBe(200)
        expect(reached).toEqual(["list:c2:COMPANY", "decide:ph-other:true"])
    })
})
