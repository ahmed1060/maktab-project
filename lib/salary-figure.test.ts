import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { figureFor, estimateNetMinor, byPeriod, periodKey, type SalaryRecordLike, type PayslipLike } from "./salary-figure"
import { toMinor } from "./payroll"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * H1, H2, H3 — the second audit's findings, which were about the repairs
 * rather than the phases.
 *
 * H1 is the one that mattered: two calculations answering the same question,
 * which is P0's two clocks and P9's two bounds wearing a third costume.
 */

const SERVICE = stripComments(readFileSync("lib/services/salary.service.ts", "utf8"))
const RUN_SERVICE = stripComments(readFileSync("lib/services/payroll-run.service.ts", "utf8"))
const HISTORY_API = stripComments(readFileSync("app/api/users/[id]/salary-history/route.ts", "utf8"))
const HISTORY_PAGE = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "utf8")
const REGISTER = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")
const WAIVE = stripComments(readFileSync("app/api/debts/[id]/waive/route.ts", "utf8"))

const record = (over: Partial<SalaryRecordLike> = {}): SalaryRecordLike => ({
    year: 2026, month: 5, totalDays: 30, deductions: 0, bonusDays: 0, baseSalary: 30000, ...over,
})
const payslip = (over: Partial<PayslipLike> = {}): PayslipLike => ({
    id: "p1", year: 2026, month: 5, status: "PAID", netMinor: toMinor("25000"), ...over,
})

describe("H1: one answer, and it is the payslip's", () => {
    it("prefers the payslip over the estimate", () => {
        // The whole finding: on a month with debt recovery the estimate says
        // 30,000 and the payslip says 25,000, and the screen used to print the
        // estimate.
        const figure = figureFor(record(), payslip())
        expect(figure.source).toBe("PAYSLIP")
        expect(figure.netMinor).toBe(toMinor("25000"))
        expect(estimateNetMinor(record())).toBe(toMinor("30000"))
    })

    it("counts an approved payslip, not only a paid one", () => {
        // Approval is the moment the figure stops moving. Showing an estimate
        // beside an approved payslip means disagreeing with a document somebody
        // may already have been sent.
        expect(figureFor(record(), payslip({ status: "APPROVED" })).source).toBe("PAYSLIP")
    })

    it("falls back to the estimate for a month payroll never ran", () => {
        const figure = figureFor(record(), null)
        expect(figure.source).toBe("ESTIMATE")
        expect(figure.netMinor).toBe(toMinor("30000"))
    })

    it("never takes a payslip from a different month", () => {
        // The index is keyed on period; this is the guard for the day somebody
        // changes how it is built.
        expect(figureFor(record({ month: 5 }), payslip({ month: 4 })).source).toBe("ESTIMATE")
        expect(figureFor(record({ year: 2026 }), payslip({ year: 2025 })).source).toBe("ESTIMATE")
    })

    it("keeps the old arithmetic exactly as it was", () => {
        // Deliberately unchanged. Quietly improving it would rewrite history
        // for every month somebody has already read.
        expect(estimateNetMinor(record({ deductions: 3 }))).toBe(toMinor("27000"))
        expect(estimateNetMinor(record({ bonusDays: 3 }))).toBe(toMinor("33000"))
        expect(estimateNetMinor(record({ deductions: 5, bonusDays: 2 }))).toBe(toMinor("27000"))
    })

    it("divides by the month's own length, not by a fixed 30", () => {
        // Every other case here uses a 30-day month, so a hard-coded 30 in the
        // divisor passed all of them — found by break-testing, not by reading.
        // February at 28 days: one day is 30,000/28.
        expect(estimateNetMinor(record({ month: 2, totalDays: 28, deductions: 1 })))
            .toBe(toMinor(String((30000 / 28) * 27)))
        // And a 31-day month is the other side of the same mistake.
        expect(estimateNetMinor(record({ month: 1, totalDays: 31, deductions: 1 })))
            .toBe(toMinor(String((30000 / 31) * 30)))
    })

    it("never estimates a negative month", () => {
        // More deductions than days is a debt, and a debt is the payroll path's
        // business rather than this screen's.
        expect(estimateNetMinor(record({ deductions: 40 }))).toBe(0)
        expect(estimateNetMinor(record({ baseSalary: 0 }))).toBe(0)
        expect(estimateNetMinor(record({ totalDays: 0 }))).toBe(0)
    })

    it("refuses a month of no days even when something was added to it", () => {
        // The case only the first guard catches: payableDays is positive, so
        // the negative check passes it through, and dividing by zero days
        // yields Infinity. A record like this should not exist — this is about
        // what the screen does when one does.
        expect(estimateNetMinor(record({ totalDays: 0, bonusDays: 2 }))).toBe(0)
        expect(Number.isFinite(estimateNetMinor(record({ totalDays: 0, bonusDays: 2 })))).toBe(true)
    })

    it("indexes a history in one pass rather than scanning per row", () => {
        const index = byPeriod([payslip({ id: "may" }), payslip({ id: "apr", month: 4 })])
        expect(index.get(periodKey({ year: 2026, month: 4 }))?.id).toBe("apr")
        expect(index.get(periodKey({ year: 2026, month: 3 }))).toBeUndefined()
    })
})

describe("H1: the screen stopped doing its own payroll", () => {
    it("no longer computes a salary in the template", () => {
        // The exact expression that was there: (base / totalDays) * payableDays.
        expect(HISTORY_PAGE).not.toMatch(/baseSalaryToUse\s*\/\s*record\.totalDays/)
        expect(HISTORY_PAGE).toContain("figure?.netMinor")
    })

    it("and the API hands it the payslip", () => {
        expect(HISTORY_API).toContain("SalaryService.historyWithPayslips")
        expect(SERVICE).toContain("figure: figureFor(record, index.get(periodKey(record)))")
    })

    it("never attaches a draft", () => {
        // A draft is recomputed every time the register is opened; a history
        // that moved between two readings is worse than one that says estimate.
        const method = SERVICE.slice(SERVICE.indexOf("static async historyWithPayslips"))
        expect(method).toContain('status: { in: ["APPROVED", "PAID"] }')
        expect(method).toContain("excluded: false")
    })

    it("says which of the two a figure is, rather than leaving it to be assumed", () => {
        expect(HISTORY_PAGE).toContain("salary_figure_estimate")
        expect(HISTORY_PAGE).toContain("salary_figure_payslip")
        expect(en.salary_figure_estimate).toMatch(/estimate/i)
    })
})

describe("H2: the debts list shows what is still owed", () => {
    it("subtracts what has been recovered", () => {
        expect(RUN_SERVICE).toContain("amount: Number(d.amount) - Number(d.recoveredAmount)")
        expect(RUN_SERVICE).toContain("originalAmount: Number(d.amount)")
    })

    it("shows the original only where it differs", () => {
        // On a debt nothing has been taken from, the two are the same number
        // and saying it twice is noise.
        expect(REGISTER).toContain("d.recoveredAmount > 0 &&")
        expect(REGISTER).toContain("payroll_debt_recovered")
    })
})

describe("H3: a debt can be written off, deliberately", () => {
    it("requires a reason", () => {
        // The difference between this and the inaction it replaces: a write-off
        // with no stated reason is indistinguishable from a mistake a year on.
        expect(WAIVE).toContain("if (reason.length < 3)")
        expect(WAIVE).toContain("Say why this debt is being written off")
    })

    it("is held to the same company check as everything else in payroll", () => {
        expect(WAIVE).toContain("managesCompany(session.user, \"debts.waive\", debt.companyId)")
    })

    it("refuses a debt that is already closed", () => {
        // Re-closing a settled debt under a different status would rewrite what
        // happened to money that actually moved.
        expect(WAIVE).toContain('if (debt.status !== "OUTSTANDING")')
    })

    it("records who, how much was forgiven, and why", () => {
        expect(WAIVE).toContain('AuditLogService.log("WAIVE_DEBT"')
        expect(WAIVE).toContain("writtenOff: Number(debt.amount) - Number(debt.recoveredAmount)")
    })

    it("and there is a control that reaches it", () => {
        // WAIVED sat in the enum unreachable since P8; a route nothing calls
        // would be the same fault with extra steps.
        expect(REGISTER).toContain("/api/debts/${debt.id}/waive")
        expect(REGISTER).toContain("payroll_debt_waive")
    })

    it("names the person and cannot be confirmed blind", () => {
        expect(REGISTER).toContain("payroll_debt_waive_title")
        expect(en.payroll_debt_waive_title).toContain("{name}")
        expect(en.payroll_debt_waive_msg).toMatch(/cannot be undone/i)
    })
})

describe("the copy exists in both languages", () => {
    it("every English key has an Arabic value", () => {
        const missing = Object.keys(en as any).filter(k => !(k in (ar as any)))
        expect(missing, `no Arabic translation:\n${missing.join("\n")}`).toEqual([])
    })
})
