import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who reaches a company's work locations (ATTENDANCE_PLAN.md §8.5, §16):
 * part of the Attendance settings tab, and only for a company holding the
 * Mobile App add-on. The service is replaced; what is checked here is who
 * reaches it.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const reached: string[] = []
vi.mock("@/lib/services/attendance-location.service", () => ({
    AttendanceLocationService: {
        list: async (companyId: string) => { reached.push(`list:${companyId}`); return { locations: [], people: [] } },
        create: async (companyId: string, input: any) => { reached.push(`create:${companyId}:${input.name}`); return { id: "new" } },
        locationOf: async (id: string) => ({ l1: { id: "l1", companyId: "c1" }, l2: { id: "l2", companyId: "c2" } } as any)[id] ?? null,
        update: async (id: string) => { reached.push(`update:${id}`); return {} },
        setPeople: async (id: string, userIds: string[]) => { reached.push(`people:${id}:${userIds.join(",")}`); return { userIds } },
        archive: async (id: string) => { reached.push(`archive:${id}`) },
        restore: async (id: string) => { reached.push(`restore:${id}`) },
    },
}))

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
const MOBILE: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceMobile: true }
const TERMINALS_ONLY: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: true }
const companies: Record<string, { adminSettingsEnabled: boolean; adminSettingsTabs: string[]; package: Pkg }> = {}

beforeEach(() => {
    reached.length = 0
    companies.c1 = { adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: MOBILE }
    companies.c2 = { adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: MOBILE }
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
const admin = (pkg: Pkg = MOBILE) => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN }, pkg)
const employee = () => signIn({ id: "emp", role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE })
const viewer = () => signIn({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: { "settings.view": "COMPANY" } })
const superAdmin = () => signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })

const OFFICE = { name: "Head office", latitude: 30.04, longitude: 31.23, radiusMeters: 150 }
const params = (id: string) => ({ params: Promise.resolve({ id }) }) as any
const list = async (query = "") => (await import("@/app/api/attendance/locations/route")).GET(new Request(url(`/api/attendance/locations${query}`)))
const add = async (body: unknown) => (await import("@/app/api/attendance/locations/route")).POST(withBody("POST", "/api/attendance/locations", body))
const patch = async (id: string, body: unknown) => (await import("@/app/api/attendance/locations/[id]/route")).PATCH(withBody("PATCH", `/api/attendance/locations/${id}`, body), params(id))
const archive = async (id: string) => (await import("@/app/api/attendance/locations/[id]/route")).DELETE(new Request(url(`/api/attendance/locations/${id}`), { method: "DELETE" }), params(id))
const restore = async (id: string) => (await import("@/app/api/attendance/locations/[id]/restore/route")).POST(new Request(url(`/api/attendance/locations/${id}/restore`), { method: "POST" }), params(id))
const people = async (id: string, body: unknown) => (await import("@/app/api/attendance/locations/[id]/people/route")).PUT(withBody("PUT", `/api/attendance/locations/${id}/people`, body), params(id))

describe("work locations: the Attendance settings tab, with the Mobile App add-on", () => {
    it("an Admin with the tab lists, adds, changes, staffs, archives and restores their company's places", async () => {
        admin()
        expect((await list()).status).toBe(200)
        expect((await add(OFFICE)).status).toBe(201)
        expect((await patch("l1", { radiusMeters: 200 })).status).toBe(200)
        expect((await people("l1", { userIds: ["e1"] })).status).toBe(200)
        expect((await archive("l1")).status).toBe(200)
        expect((await restore("l1")).status).toBe(200)
        expect(reached).toEqual(["list:c1", "create:c1:Head office", "update:l1", "people:l1:e1", "archive:l1", "restore:l1"])
    })

    it("refuses a body of the wrong shape before reaching anything", async () => {
        admin()
        expect((await add({ ...OFFICE, latitude: "north" })).status).toBe(400)
        expect((await patch("l1", { radiusMeters: 12.5 })).status).toBe(400)
        expect((await people("l1", { userIds: "e1" })).status).toBe(400)
        expect(reached).toEqual([])
    })

    it("is held to their own company: another's place is as if absent", async () => {
        admin()
        expect((await add({ ...OFFICE, companyId: "c2" })).status).toBe(201)
        expect((await patch("l2", { name: "Mine" })).status).toBe(404)
        expect((await people("l2", { userIds: [] })).status).toBe(404)
        expect((await archive("nope")).status).toBe(404)
        expect(reached).toEqual(["create:c1:Head office"])
    })

    it("lets whoever only sees settings look, not change", async () => {
        viewer()
        expect((await list()).status).toBe(200)
        expect((await add(OFFICE)).status).toBe(403)
        expect((await patch("l1", { name: "x" })).status).toBe(403)
        expect((await people("l1", { userIds: [] })).status).toBe(403)
        expect(reached).toEqual(["list:c1"])
    })

    it("shows nothing to an employee", async () => {
        employee()
        expect((await list()).status).toBe(404)
        expect((await add(OFFICE)).status).toBe(404)
        expect(reached).toEqual([])
    })

    it("is closed to a company with attendance from terminals only", async () => {
        companies.c1.package = TERMINALS_ONLY
        admin(TERMINALS_ONLY)
        expect((await list()).status).toBe(403)
        expect((await add(OFFICE)).status).toBe(403)
        expect(reached).toEqual([])
    })

    it("lets the Super Admin act for a company they name", async () => {
        superAdmin()
        expect((await list()).status).toBe(400)
        expect((await list("?companyId=c2")).status).toBe(200)
        expect((await archive("l2")).status).toBe(200)
        expect(reached).toEqual(["list:c2", "archive:l2"])
    })
})
