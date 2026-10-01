import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who may read and change a company's attendance calendar
 * (ATTENDANCE_PLAN.md §5.2, §7): it is the company's Attendance settings tab,
 * so every route asks the tab's questions — the company holds attendance, the
 * Super Admin has shown it the tab, the person holds settings.view (and
 * settings.edit to change anything) — and the attendance gate in front of
 * /api/attendance asks whether their company bought it. The service is
 * replaced; what is checked here is who reaches it.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const reached: string[] = []
vi.mock("@/lib/services/attendance-calendar.service", () => ({
    AttendanceCalendarService: {
        today: async () => "2026-10-01",
        calendar: async (companyId: string) => { reached.push(`calendar:${companyId}`); return { schedules: [] } },
        createSchedule: async (companyId: string) => { reached.push(`createSchedule:${companyId}`); return { id: "s-new" } },
        scheduleOf: async (id: string) => id === "s1" ? { id: "s1", companyId: "c1" } : id === "s2" ? { id: "s2", companyId: "c2" } : null,
        updateSchedule: async (id: string) => { reached.push(`updateSchedule:${id}`); return {} },
        archiveSchedule: async (id: string) => { reached.push(`archiveSchedule:${id}`) },
        addVersion: async (id: string) => { reached.push(`addVersion:${id}`); return {} },
        assign: async (companyId: string) => { reached.push(`assign:${companyId}`) },
        addHoliday: async (companyId: string) => { reached.push(`addHoliday:${companyId}`); return {} },
        setObserved: async (companyId: string) => { reached.push(`setObserved:${companyId}`) },
    },
}))
vi.mock("@/lib/services/attendance-policy.service", () => ({
    AttendancePolicyService: {
        versions: async (companyId: string) => { reached.push(`policy:${companyId}`); return [] },
        templates: async () => [],
        saveVersion: async (companyId: string) => { reached.push(`savePolicy:${companyId}`); return {} },
        versionOf: async (id: string) => id === "p1" ? { id: "p1", companyId: "c1" } : id === "p2" ? { id: "p2", companyId: "c2" } : null,
        deleteVersion: async (id: string) => { reached.push(`deletePolicy:${id}`) },
        createTemplate: async () => { reached.push("createTemplate"); return {} },
    },
}))
vi.mock("@/lib/services/public-holiday.service", () => ({
    PublicHolidayService: {
        list: async () => { reached.push("listPublic"); return [] },
        create: async () => { reached.push("createPublic"); return {} },
    },
}))

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
const companies: Record<string, { adminSettingsEnabled: boolean; adminSettingsTabs: string[]; package: Pkg }> = {}
const ATTENDANCE: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceMobile: true }

beforeEach(() => {
    reached.length = 0
    companies.c1 = { adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: ATTENDANCE }
    companies.c2 = { adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: ATTENDANCE }
    prismaMock.company.findUnique = async ({ where }: any) => companies[where.id] ? { id: where.id, ...companies[where.id] } : null
})

/** Somebody signed in, their company's purchases in their token as the session carries them. */
function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }, pkg: Pkg = ATTENDANCE) {
    state.session = {
        user: stepUpConfirmed({
            ...user,
            grants: user.grants ? encodeGrants(user.grants as any) : undefined,
            featureAccess: serializeAccess(resolveBundles(pkg, { isSuperAdmin: user.role === "SUPER_ADMIN" })),
        }),
    }
}
const admin = () => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN })
const employee = () => signIn({ id: "emp", role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE })
const viewer = () => signIn({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: { "settings.view": "COMPANY" } })
const superAdmin = () => signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })

const getCalendar = async (query = "") => (await import("@/app/api/attendance/calendar/route")).GET(new Request(url(`/api/attendance/calendar${query}`)))
const createSchedule = async (body: unknown) => (await import("@/app/api/attendance/schedules/route")).POST(withBody("POST", "/api/attendance/schedules", body))
const patchSchedule = async (id: string, body: unknown) =>
    (await import("@/app/api/attendance/schedules/[id]/route")).PATCH(withBody("PATCH", `/api/attendance/schedules/${id}`, body), { params: Promise.resolve({ id }) } as any)
const addVersion = async (id: string, body: unknown) =>
    (await import("@/app/api/attendance/schedules/[id]/versions/route")).POST(withBody("POST", `/api/attendance/schedules/${id}/versions`, body), { params: Promise.resolve({ id }) } as any)
const assign = async (body: unknown) => (await import("@/app/api/attendance/assignments/route")).POST(withBody("POST", "/api/attendance/assignments", body))
const observe = async (body: unknown) => (await import("@/app/api/attendance/holidays/observed/route")).PUT(withBody("PUT", "/api/attendance/holidays/observed", body))
const publicList = async () => (await import("@/app/api/public-holidays/route")).GET(new Request(url("/api/public-holidays?year=2026")))
const publicCreate = async (body: unknown) => (await import("@/app/api/public-holidays/route")).POST(withBody("POST", "/api/public-holidays", body))

const SCHEDULE = { name: "Office", version: { effectiveFrom: "2026-10-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60 } }
const VERSION = { effectiveFrom: "2026-11-01", startMinutes: 480, endMinutes: 960 }

describe("the company's own people", () => {
    it("an Admin with the tab shown reads and changes their own company's calendar", async () => {
        admin()
        expect((await getCalendar()).status).toBe(200)
        expect((await createSchedule(SCHEDULE)).status).toBe(201)
        expect((await addVersion("s1", VERSION)).status).toBe(201)
        expect((await assign({ userIds: ["emp"], scheduleId: "s1", effectiveFrom: "2026-11-01" })).status).toBe(200)
        expect(reached).toEqual(["calendar:c1", "createSchedule:c1", "addVersion:s1", "assign:c1"])
    })

    it("is held to their own company, whatever company they name", async () => {
        admin()
        expect((await getCalendar("?companyId=c2")).status).toBe(200)
        expect((await createSchedule({ ...SCHEDULE, companyId: "c2" })).status).toBe(201)
        expect(reached).toEqual(["calendar:c1", "createSchedule:c1"])
        // Another company's schedule by id: as if it did not exist.
        expect((await addVersion("s2", VERSION)).status).toBe(404)
        expect((await patchSchedule("s2", { name: "Mine now" })).status).toBe(404)
        expect(reached).not.toContain("addVersion:s2")
    })

    it("sees nothing while the Super Admin has not shown the tab", async () => {
        companies.c1.adminSettingsTabs = ["general"]
        admin()
        expect((await getCalendar()).status).toBe(404)
        expect((await createSchedule(SCHEDULE)).status).toBe(404)
        companies.c1.adminSettingsTabs = ["attendance"]
        companies.c1.adminSettingsEnabled = false
        expect((await getCalendar()).status).toBe(404)
        expect(reached).toEqual([])
    })

    it("reads but cannot change it with settings.view alone", async () => {
        viewer()
        expect((await getCalendar()).status).toBe(200)
        expect((await createSchedule(SCHEDULE)).status).toBe(403)
        expect((await addVersion("s1", VERSION)).status).toBe(403)
        expect((await observe({ publicHolidayId: "h1", observed: false })).status).toBe(403)
        expect(reached).toEqual(["calendar:c1"])
    })

    it("an employee without settings permissions gets nothing", async () => {
        employee()
        expect((await getCalendar()).status).toBe(404)
        expect((await createSchedule(SCHEDULE)).status).toBe(404)
        expect(reached).toEqual([])
    })
})

describe("a company that has not bought attendance", () => {
    const HR_ONLY: Pkg = { hasCompanyManagement: true, hasHR: true }

    it("is stopped at the gate, before any route runs", async () => {
        companies.c1.package = HR_ONLY
        signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN }, HR_ONLY)
        const res = await getCalendar()
        expect(res.status).toBe(403)
        expect((await res.json()).error).toContain("Attendance — Terminals or Attendance — Mobile App")
        expect(reached).toEqual([])
    })

    it("has no Attendance tab even for the Super Admin", async () => {
        companies.c1.package = HR_ONLY
        superAdmin()
        expect((await getCalendar("?companyId=c1")).status).toBe(404)
        expect((await createSchedule({ ...SCHEDULE, companyId: "c1" })).status).toBe(404)
        expect(reached).toEqual([])
    })
})

describe("the Super Admin", () => {
    it("works on the company they name, and must name one", async () => {
        superAdmin()
        expect((await getCalendar("?companyId=c2")).status).toBe(200)
        expect((await getCalendar()).status).toBe(400)
        expect((await createSchedule({ ...SCHEDULE, companyId: "c2" })).status).toBe(201)
        expect((await addVersion("s2", VERSION)).status).toBe(201)
        expect(reached).toEqual(["calendar:c2", "createSchedule:c2", "addVersion:s2"])
    })

    it("alone keeps the central holiday calendar", async () => {
        superAdmin()
        expect((await publicList()).status).toBe(200)
        expect((await publicCreate({ date: "2026-04-13", name: "Sham El Nessim" })).status).toBe(201)
        admin()
        expect((await publicList()).status).toBe(403)
        expect((await publicCreate({ date: "2026-04-13", name: "Sham El Nessim" })).status).toBe(403)
        expect(reached).toEqual(["listPublic", "createPublic"])
    })
})

describe("the policy", () => {
    const getPolicy = async (query = "") => (await import("@/app/api/attendance/policy/route")).GET(new Request(url(`/api/attendance/policy${query}`)))
    const savePolicy = async (body: unknown) => (await import("@/app/api/attendance/policy/route")).POST(withBody("POST", "/api/attendance/policy", body))
    const deletePolicy = async (id: string) =>
        (await import("@/app/api/attendance/policy/[id]/route")).DELETE(withBody("DELETE", `/api/attendance/policy/${id}`, {}), { params: Promise.resolve({ id }) } as any)
    const createTemplate = async (body: unknown) => (await import("@/app/api/policy-templates/route")).POST(withBody("POST", "/api/policy-templates", body))
    const POLICY = { effectiveFrom: "2026-11-01", body: { workWeek: [0, 1, 2, 3, 4] } }

    it("is read and set through the Attendance tab's own rules", async () => {
        admin()
        expect((await getPolicy()).status).toBe(200)
        expect((await savePolicy({ ...POLICY, companyId: "c2" })).status).toBe(201)
        expect((await deletePolicy("p1")).status).toBe(200)
        expect((await deletePolicy("p2")).status).toBe(404)
        viewer()
        expect((await getPolicy()).status).toBe(200)
        expect((await savePolicy(POLICY)).status).toBe(403)
        expect((await deletePolicy("p1")).status).toBe(403)
        employee()
        expect((await getPolicy()).status).toBe(404)
        expect(reached).toEqual(["policy:c1", "savePolicy:c1", "deletePolicy:p1", "policy:c1"])
    })

    it("has templates only the Super Admin keeps", async () => {
        admin()
        expect((await createTemplate({ name: "Mine", body: {} })).status).toBe(403)
        superAdmin()
        expect((await createTemplate({ name: "Night shift", body: {} })).status).toBe(201)
        expect(reached).toEqual(["createTemplate"])
    })
})

describe("what the routes take", () => {
    it("refuses a body that is not the shape, before the service sees it", async () => {
        admin()
        expect((await createSchedule({ name: "Office" })).status).toBe(400)
        expect((await addVersion("s1", { effectiveFrom: "1st of November", startMinutes: 480, endMinutes: 960 })).status).toBe(400)
        expect((await assign({ userIds: [], scheduleId: "s1", effectiveFrom: "2026-11-01" })).status).toBe(400)
        expect(reached).toEqual([])
    })

    it("answers the service's refusals in words, not as a fault", async () => {
        const { knownRefusal } = await import("./api-errors")
        for (const code of ["PAYROLL_MONTH_LOCKED", "OVERRIDE_OVERLAPS", "SCHEDULE_IN_USE", "END_NOT_AFTER_START", "HOLIDAY_DATE_TAKEN"]) {
            expect(knownRefusal(new Error(code)), code).toBeTruthy()
        }
        expect(knownRefusal(new Error("PAYROLL_MONTH_LOCKED"))?.status).toBe(409)
    })
})
