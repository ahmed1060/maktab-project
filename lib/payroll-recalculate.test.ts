import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { withGrants } from "./permissions/test-actors"
import { encodeGrants } from "./permissions/grants"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Recalculate this month, on the Payroll page (LATER_CHANGES_PLAN.md §7.1,
 * step 2, PR 425): a draft month's attendance worked out again, for whoever
 * may save the draft, where the company has attendance; then the register
 * read again, which works out the draft payroll from those days. Refused,
 * before anything is worked out, once the month's payroll is approved.
 */

const state = { session: null as unknown, runs: [] as { companyId: string; year: number; month: number; status: string }[] }
const packages: Record<string, unknown> = {
    c1: { hasHR: true, hasAttendanceTerminals: true },
    c2: { hasHR: true, hasAttendanceMobile: true },
    bare: { hasHR: true },
}
const recomputed: string[] = []
const answer = { locked: false }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        payrollRun: {
            findMany: async ({ where }: { where: { companyId: string; status: { in: string[] }; OR: { year: number; month: number }[] } }) =>
                state.runs.filter(r => r.companyId === where.companyId && where.status.in.includes(r.status) && where.OR.some(m => m.year === r.year && m.month === r.month)),
        },
    },
}))
vi.mock("@/lib/services/company.service", () => ({
    CompanyService: { settingsExposure: async (id: string) => (id in packages ? { id, package: packages[id] } : null) },
}))
// The month's period: the calendar month, unless a test says (LATER_CHANGES_PLAN.md §7.10, PR 430).
const periods: Record<string, { from: string; to: string }> = {}
vi.mock("@/lib/services/payroll-period.service", () => ({
    PayrollPeriodService: {
        periodOf: async (_db: unknown, companyId: string, year: number, month: number) => {
            const key = `${year}-${String(month).padStart(2, "0")}`
            return periods[`${companyId}:${key}`] ?? { from: `${key}-01`, to: `${key}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}` }
        },
    },
}))
vi.mock("@/lib/services/attendance-engine.service", () => ({
    AttendanceEngineService: {
        recomputeMonth: async (companyId: string, month: string) => {
            recomputed.push(`${companyId}:${month}`)
            return { month, locked: answer.locked, derived: 3, written: 2, removed: 0 }
        },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
const employee = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
const superAdmin = { id: "s1", role: "SUPER_ADMIN", companyId: null }
// Sees the register, and may not save the draft.
const viewer = { id: "v1", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "payroll.view": "COMPANY" } as never) }

beforeEach(() => {
    state.runs = []
    recomputed.length = 0
    answer.locked = false
})

const recalculate = async (user: unknown, year: string, month: string, body: Record<string, unknown> = {}) => {
    state.session = { user }
    const { POST } = await import("@/app/api/payroll/[year]/[month]/recalculate/route")
    const res = await POST(new Request(`https://nizmo.test/api/payroll/${year}/${month}/recalculate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ year, month }) } as never)
    return { status: res.status, body: await res.json() }
}

describe("recalculating a draft month", () => {
    it("works out the month's attendance again, for whoever may save the draft, in their own company", async () => {
        const done = await recalculate(admin, "2026", "11", { companyId: "c2" })
        expect(done.status).toBe(200)
        expect(done.body.data).toEqual({ month: "2026-11", written: 2, removed: 0 })
        expect(recomputed).toEqual(["c1:2026-11"])
    })

    it("works out every calendar month its period touches, closing on the 24th reaching back into the one before (PR 430)", async () => {
        periods["c1:2026-11"] = { from: "2026-10-25", to: "2026-11-24" }
        const done = await recalculate(admin, "2026", "11", { companyId: "c2" })
        delete periods["c1:2026-11"]
        expect(done.status).toBe(200)
        expect(done.body.data).toEqual({ month: "2026-11", written: 4, removed: 0 })
        expect(recomputed).toEqual(["c1:2026-10", "c1:2026-11"])
    })

    it("works out the company asked about, for the Super Admin, and none that isn't there", async () => {
        expect((await recalculate(superAdmin, "2026", "3", { companyId: "c2" })).status).toBe(200)
        expect(recomputed).toEqual(["c2:2026-03"])
        expect((await recalculate(superAdmin, "2026", "3", { companyId: "gone" })).status).toBe(404)
        expect(recomputed).toEqual(["c2:2026-03"])
    })

    it("refuses whoever may not save the draft, one who sees the register too", async () => {
        expect((await recalculate(employee, "2026", "11")).status).toBe(403)
        expect((await recalculate(viewer, "2026", "11")).status).toBe(403)
        expect(recomputed).toEqual([])
    })

    it("refuses a month that isn't one", async () => {
        expect((await recalculate(admin, "2026", "13")).status).toBe(400)
        expect(recomputed).toEqual([])
    })

    it("refuses a company without attendance, saying so", async () => {
        const refused = await recalculate(superAdmin, "2026", "11", { companyId: "bare" })
        expect(refused.status).toBe(409)
        expect(refused.body.code).toBe("NO_ATTENDANCE")
        expect(recomputed).toEqual([])
    })

    it("refuses an approved or paid month before working anything out", async () => {
        for (const status of ["APPROVED", "PAID"]) {
            state.runs = [{ companyId: "c1", year: 2026, month: 10, status }]
            const refused = await recalculate(admin, "2026", "10")
            expect(refused.status, status).toBe(409)
            expect(refused.body.code, status).toBe("PAYROLL_MONTH_LOCKED")
        }
        expect(recomputed).toEqual([])
        // Another company's approved month, or this company's draft, is no matter.
        state.runs = [{ companyId: "c2", year: 2026, month: 10, status: "APPROVED" }, { companyId: "c1", year: 2026, month: 10, status: "DRAFT" }]
        expect((await recalculate(admin, "2026", "10")).status).toBe(200)
    })

    it("says so where the month was approved while it was asked", async () => {
        answer.locked = true
        const refused = await recalculate(admin, "2026", "11")
        expect(refused.status).toBe(409)
        expect(refused.body.code).toBe("PAYROLL_MONTH_LOCKED")
    })
})

const source = (path: string) => stripComments(readFileSync(path, "utf8"))

describe("the Payroll page", () => {
    const page = () => source("app/(dashboard)/dashboard/payroll/page.tsx")

    it("offers Recalculate this month on a draft month, before Save draft, to whoever may save it, where the company has attendance", () => {
        expect(page()).toContain("const canRecalculate = isDraft && canPrepare && features.has('ATTENDANCE')")
        expect(page()).toMatch(/\{canRecalculate && \(\s*<Button onClick=\{\(\) => action\.run\('recalculate', recalculate\)\} disabled=\{action\.running\} busy=\{action\.is\('recalculate'\)\}>\s*\{t\('payroll_recalculate'\)\}/)
        expect(page().indexOf("t('payroll_recalculate')")).toBeLessThan(page().indexOf("t('payroll_save_draft')"))
        expect(page()).toContain("action={isDraft && (canPrepare || canApprove) && (")
    })

    it("asks for the month in view, of the company in view, then reads the register again", () => {
        expect(page()).toContain("const res = await fetch(`/api/payroll/${year}/${month}/recalculate`, {")
        expect(page()).toMatch(/recalculate`, \{\s*method: 'POST',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ companyId: companyId \|\| undefined \}\),/)
        expect(page()).toContain("if (res.ok || body?.code === 'PAYROLL_MONTH_LOCKED') load()")
    })

    it("says what happened, in either language", () => {
        expect(page()).toContain("body?.code === 'PAYROLL_MONTH_LOCKED' ? t('day_recompute_locked')")
        expect(page()).toContain("body?.code === 'NO_ATTENDANCE' ? t('payroll_recalculate_no_attendance')")
        for (const words of [en, ar]) {
            expect(words.payroll_recalculate).toBeTruthy()
            expect(words.payroll_recalculated).toBeTruthy()
            expect(words.payroll_recalculate_no_attendance).toBeTruthy()
            expect(words.payroll_recalculate_failed).toBeTruthy()
        }
        expect(ar.payroll_recalculate).toBe("إعادة احتساب هذا الشهر")
        expect(en.payroll_recalculate).toBe("Recalculate this month")
    })
})
