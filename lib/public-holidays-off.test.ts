import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"
import { expectedDay, observedHolidays, publicHolidaysApplyOn, type Schedule } from "./attendance/calendar"
import { knownRefusal } from "./api-errors"
import { AUDIT_ACTIONS } from "./audit-codes"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Public holidays off for a company (FIRST_CHANGES_PLAN.md §6, PR 362): one
 * switch, from a date, for whoever may change the Attendance settings tab.
 * While it's off, every central holiday is a normal workday for the company,
 * and its own holidays still apply. The rule, who reaches it, and its words.
 * The database's side is lib/public-holidays-off.db.test.ts; the card's,
 * lib/public-holidays-off-card.test.ts. All names are made up.
 */

const OFF_SEP = [{ effectiveFrom: "2026-09-01", apply: false }]
const OFF_THEN_ON = [{ effectiveFrom: "2026-09-12", apply: true }, { effectiveFrom: "2026-09-01", apply: false }]

describe("whether public holidays apply on a date", () => {
    it("they do with no change, and as the last change on or before the date says", () => {
        expect(publicHolidaysApplyOn([], "2026-09-10")).toBe(true)
        expect(publicHolidaysApplyOn(OFF_SEP, "2026-08-31")).toBe(true)
        expect(publicHolidaysApplyOn(OFF_SEP, "2026-09-01")).toBe(false)
        expect(publicHolidaysApplyOn(OFF_SEP, "2027-05-01")).toBe(false)
        // Out of order, as they may come: the latest date decides.
        expect(publicHolidaysApplyOn(OFF_THEN_ON, "2026-09-10")).toBe(false)
        expect(publicHolidaysApplyOn(OFF_THEN_ON, "2026-09-12")).toBe(true)
        expect(publicHolidaysApplyOn(OFF_THEN_ON, "2026-10-06")).toBe(true)
    })
})

describe("the holidays observed while they're off", () => {
    const central = [
        { id: "sinai", date: "2026-04-25", name: "Sinai Liberation Day" },
        { id: "forces", date: "2026-10-06", name: "Armed Forces Day" },
        { id: "test", date: "2026-09-10", name: "Test Day" },
    ]
    const own = [{ id: "founders", date: "2026-09-15", name: "Founders' Day", isPaid: true }]

    it("leave out every central one from the date, ones before it kept, and the company's own still apply", () => {
        const days = observedHolidays(central, new Set(), own, "2026-01-01", "2026-12-31", OFF_SEP)
        expect([...days.keys()].sort()).toEqual(["2026-04-25", "2026-09-15"])
        expect(days.get("2026-09-15")).toMatchObject({ source: "COMPANY" })
    })

    it("take them back from the date they're turned on again", () => {
        const days = observedHolidays(central, new Set(), own, "2026-01-01", "2026-12-31", OFF_THEN_ON)
        expect([...days.keys()].sort()).toEqual(["2026-04-25", "2026-09-15", "2026-10-06"])
    })

    it("keep the ones the company works through out once they're back on", () => {
        const days = observedHolidays(central, new Set(["forces"]), [], "2026-01-01", "2026-12-31", OFF_THEN_ON)
        expect(days.has("2026-10-06")).toBe(false)
    })

    it("make the day a workday, measured against the schedule's hours", () => {
        const office: Schedule = {
            id: "s1", overrides: [],
            versions: [{ id: "v1", effectiveFrom: "2026-01-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60, workWeek: [], days: [] }],
        }
        const on = observedHolidays(central, new Set(), [], "2026-09-10", "2026-09-10", [])
        const off = observedHolidays(central, new Set(), [], "2026-09-10", "2026-09-10", OFF_SEP)
        // 10 September 2026 is a Thursday, a working day.
        const workWeek = [0, 1, 2, 3, 4]
        expect(expectedDay({ date: "2026-09-10", schedule: office, companyWorkWeek: workWeek, holiday: on.get("2026-09-10") ?? null }).kind).toBe("HOLIDAY")
        expect(expectedDay({ date: "2026-09-10", schedule: office, companyWorkWeek: workWeek, holiday: off.get("2026-09-10") ?? null })).toMatchObject({ kind: "WORK", hours: { startMinutes: 540 } })
    })
})

describe("the engine", () => {
    it("reads the switch everywhere it works out holidays", () => {
        const engine = readFileSync("lib/services/attendance-engine.service.ts", "utf8")
        expect(engine.match(/\.publicHolidaysChange\.findMany\(\{ where: \{ companyId \}/g)).toHaveLength(2)
        // Each call to observedHolidays is given the changes.
        const calls = [...engine.matchAll(/observedHolidays\(([^]*?)\n\s*\)/g)].map(m => m[1])
        expect(calls).toHaveLength(2)
        for (const call of calls) expect(call).toContain("publicChanges.map(c => ({ effectiveFrom: toDateString(c.effectiveFrom), apply: c.apply }))")
    })
})

// --- who reaches it ---------------------------------------------------------

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
const reached: string[] = []
vi.mock("@/lib/services/attendance-calendar.service", () => ({
    AttendanceCalendarService: {
        setPublicHolidays: async (companyId: string, apply: boolean, from: string) => { reached.push(`set:${companyId}:${apply}:${from}`) },
        publicHolidaysChangeOf: async (id: string) => id === "ch1" ? { id: "ch1", companyId: "c1" } : id === "ch2" ? { id: "ch2", companyId: "c2" } : null,
        withdrawPublicHolidaysChange: async (id: string) => { reached.push(`withdraw:${id}`) },
    },
}))

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
const ATTENDANCE: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: true }
const companies: Record<string, { adminSettingsEnabled: boolean; adminSettingsTabs: string[]; package: Pkg }> = {}

beforeEach(() => {
    reached.length = 0
    companies.c1 = { adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: ATTENDANCE }
    companies.c2 = { adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: ATTENDANCE }
    prismaMock.company.findUnique = async ({ where }: any) => companies[where.id] ? { id: where.id, ...companies[where.id] } : null
})

function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }) {
    state.session = {
        user: stepUpConfirmed({
            ...user,
            grants: user.grants ? encodeGrants(user.grants as any) : undefined,
            featureAccess: serializeAccess(resolveBundles(ATTENDANCE, { isSuperAdmin: user.role === "SUPER_ADMIN" })),
        }),
    }
}
const admin = () => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN })
const viewer = () => signIn({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: { "settings.view": "COMPANY" } })
const employee = () => signIn({ id: "emp", role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE })
const superAdmin = () => signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })

const turn = async (body: unknown) => (await import("@/app/api/attendance/holidays/apply/route")).PUT(withBody("PUT", "/api/attendance/holidays/apply", body))
const withdraw = async (id: string) =>
    (await import("@/app/api/attendance/holidays/apply/[id]/route")).DELETE(new Request(url(`/api/attendance/holidays/apply/${id}`), { method: "DELETE" }), { params: Promise.resolve({ id }) } as any)

const OFF = { apply: false, effectiveFrom: "2026-12-01" }

describe("who may turn them off or on", () => {
    it("the company's Admin with the Attendance tab shown, for their own company whatever they name", async () => {
        admin()
        expect((await turn(OFF)).status).toBe(200)
        expect((await turn({ ...OFF, apply: true, companyId: "c2" })).status).toBe(200)
        expect(reached).toEqual(["set:c1:false:2026-12-01", "set:c1:true:2026-12-01"])
    })

    it("not while the Super Admin hasn't given them the tab", async () => {
        companies.c1.adminSettingsTabs = ["general"]
        admin()
        expect((await turn(OFF)).status).toBe(404)
        companies.c1.adminSettingsTabs = ["attendance"]
        companies.c1.adminSettingsEnabled = false
        expect((await turn(OFF)).status).toBe(404)
        expect(reached).toEqual([])
    })

    it("not whoever may only look at the tab, nor an employee", async () => {
        viewer()
        expect((await turn(OFF)).status).toBe(403)
        employee()
        expect((await turn(OFF)).status).toBe(404)
        expect(reached).toEqual([])
    })

    it("the Super Admin, for the company they name, and they must name one", async () => {
        superAdmin()
        expect((await turn({ ...OFF, companyId: "c2" })).status).toBe(200)
        expect((await turn(OFF)).status).toBe(400)
        expect(reached).toEqual(["set:c2:false:2026-12-01"])
    })

    it("says what it needs", async () => {
        admin()
        expect((await turn({ apply: "no", effectiveFrom: "2026-12-01" })).status).toBe(400)
        expect((await turn({ apply: false })).status).toBe(400)
        expect(reached).toEqual([])
    })
})

describe("who may withdraw a change to come", () => {
    it("the company's Admin, their own company's alone: another's is as if it weren't there", async () => {
        admin()
        expect((await withdraw("ch1")).status).toBe(200)
        expect((await withdraw("ch2")).status).toBe(404)
        expect((await withdraw("nope")).status).toBe(404)
        expect(reached).toEqual(["withdraw:ch1"])
    })

    it("not whoever may only look", async () => {
        viewer()
        expect((await withdraw("ch1")).status).toBe(403)
        expect(reached).toEqual([])
    })

    it("the Super Admin, any company's", async () => {
        superAdmin()
        expect((await withdraw("ch2")).status).toBe(200)
        expect(reached).toEqual(["withdraw:ch2"])
    })
})

describe("its refusals, audit and words", () => {
    it("refuses in so many words", () => {
        expect(knownRefusal(new Error("PUBLIC_HOLIDAYS_CHANGE_TO_COME"))).toMatchObject({ status: 409, message: "A change of public holidays is already to come. Withdraw it first." })
        expect(knownRefusal(new Error("PUBLIC_HOLIDAYS_CHANGED_LATER"))?.status).toBe(409)
        expect(knownRefusal(new Error("PUBLIC_HOLIDAYS_ALREADY_OFF"))?.status).toBe(409)
        expect(knownRefusal(new Error("PUBLIC_HOLIDAYS_ALREADY_ON"))?.status).toBe(409)
        expect(knownRefusal(new Error("PUBLIC_HOLIDAYS_CHANGE_NOT_FOUND"))?.status).toBe(404)
        expect(knownRefusal(new Error("PUBLIC_HOLIDAYS_CHANGE_BEGUN"))?.status).toBe(409)
    })

    it("records each change in the audit log, named in both languages", () => {
        for (const action of ["TURN_OFF_PUBLIC_HOLIDAYS", "TURN_ON_PUBLIC_HOLIDAYS", "WITHDRAW_PUBLIC_HOLIDAYS_CHANGE"] as const) {
            expect(AUDIT_ACTIONS).toContain(action)
            expect(en[`audit_action_${action}`], action).toBeTruthy()
            expect(ar[`audit_action_${action}`], action).toBeTruthy()
        }
        expect(en.audit_action_TURN_OFF_PUBLIC_HOLIDAYS).toBe("Turned public holidays off")
        expect(ar.audit_action_TURN_OFF_PUBLIC_HOLIDAYS).toBe("تم إيقاف العطلات الرسمية")
    })

    it("has its table in a migration that only adds, with Row Level Security on", () => {
        const sql = readFileSync("prisma/migrations/20270117000000_public_holidays_changes/migration.sql", "utf8")
        expect(sql).toContain('CREATE TABLE "PublicHolidaysChange"')
        expect(sql).toContain('CREATE UNIQUE INDEX "PublicHolidaysChange_companyId_effectiveFrom_key"')
        expect(sql).toContain('ALTER TABLE "PublicHolidaysChange" ENABLE ROW LEVEL SECURITY;')
        // Statements that only add: the table, its index, its key to the company, and RLS.
        const statements = sql.replace(/--.*$/gm, "").split(";").map(x => x.trim()).filter(Boolean)
        for (const line of statements) expect(line, line).toMatch(/^(CREATE TABLE "PublicHolidaysChange"|CREATE UNIQUE INDEX |ALTER TABLE "PublicHolidaysChange" (ADD CONSTRAINT|ENABLE ROW LEVEL SECURITY))/)
    })
})
