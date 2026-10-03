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
vi.mock("@/lib/services/attendance-check-in.service", () => ({
    AttendanceCheckInService: { checkIn: async (companyId: string, userId: string, _input: unknown, ip: string | null) => { reached.push(`checkIn:${companyId}:${userId}:${ip}`); return { outcome: "REFUSED", reason: "MOCK_LOCATION" } } },
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
const CHECK_IN = { nonce: "n".repeat(43), keyFingerprint: "a".repeat(64), signature: "BBBB", latitude: 30.04, longitude: 31.23, accuracyMeters: 12, mocked: false }
const checkIn = async (body: unknown, ip?: string, headers: Record<string, string> = {}) => (await import("@/app/api/attendance/check-in/route")).POST(
    new Request(url("/api/attendance/check-in"), { method: "POST", headers: { "Content-Type": "application/json", ...(ip && { "x-forwarded-for": `${ip}, 10.0.0.1` }), ...headers }, body: JSON.stringify(body) }),
)
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

describe("checking in", () => {
    it("is one's own, with the address it came from, and a refusal is an answer, not an error", async () => {
        employee()
        const res = await checkIn(CHECK_IN, "203.0.113.7")
        expect(res.status).toBe(200)
        expect((await res.json()).data).toEqual({ outcome: "REFUSED", reason: "MOCK_LOCATION" })
        expect(reached).toEqual(["checkIn:c1:e1:203.0.113.7"])
    })

    it("takes the address Vercel saw over one the caller wrote: office IPs can't be claimed", async () => {
        employee()
        await checkIn(CHECK_IN, "198.51.100.20", { "x-vercel-forwarded-for": "203.0.113.99" })
        expect(reached).toEqual(["checkIn:c1:e1:203.0.113.99"])
    })

    it("refuses a body of the wrong shape, a company without the app, and the Super Admin", async () => {
        employee()
        expect((await checkIn({ ...CHECK_IN, latitude: 91 })).status).toBe(400)
        expect((await checkIn({ ...CHECK_IN, keyFingerprint: "not hex" })).status).toBe(400)
        companies.c1.package = TERMINALS_ONLY
        employee("e1", TERMINALS_ONLY)
        expect((await checkIn(CHECK_IN)).status).toBe(403)
        superAdmin()
        expect((await checkIn(CHECK_IN)).status).toBe(404)
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

describe("telling the server where to push", () => {
    const pushToken = async (body: unknown) => (await import("@/app/api/attendance/phone/push-token/route")).POST(withBody("POST", "/api/attendance/phone/push-token", body))
    const saved: any[] = []
    beforeEach(() => {
        saved.length = 0
        // Only Ehab's own phone in use or waiting matches.
        prismaMock.checkInPhone.updateMany = async ({ where, data }: any) => {
            saved.push({ where, data })
            const ok = where.userId === "e1" && where.keyFingerprint === "a".repeat(64) && where.status.in.includes("ACTIVE") && where.status.in.includes("PENDING")
            return { count: ok ? 1 : 0 }
        }
    })

    it("saves the token on the person's own phone, and only theirs", async () => {
        employee()
        expect((await pushToken({ keyFingerprint: "a".repeat(64), token: "fcm-token" })).status).toBe(200)
        expect(saved[0].data).toMatchObject({ pushToken: "fcm-token" })
        expect((await pushToken({ keyFingerprint: "b".repeat(64), token: "fcm-token" })).status).toBe(404)
        employee("e2")
        expect((await pushToken({ keyFingerprint: "a".repeat(64), token: "fcm-token" })).status).toBe(404)
    })

    it("refuses a bad body, a company without the app, and the Super Admin", async () => {
        employee()
        expect((await pushToken({ keyFingerprint: "nope", token: "t" })).status).toBe(400)
        expect((await pushToken({ keyFingerprint: "a".repeat(64), token: "" })).status).toBe(400)
        companies.c1.package = TERMINALS_ONLY
        employee("e1", TERMINALS_ONLY)
        expect((await pushToken({ keyFingerprint: "a".repeat(64), token: "t" })).status).toBe(403)
        superAdmin()
        expect((await pushToken({ keyFingerprint: "a".repeat(64), token: "t" })).status).toBe(404)
        expect(saved).toHaveLength(0)
    })
})
