import { describe, it, expect } from "vitest"
import {
    deductionLines, deductionErrors, orderedDeductions, percentOf, deductionSource, figure, deductionsKept,
    MAX_MORE_DEDUCTIONS, DEDUCTION_NAME_MAX, PAYROLL_DEDUCTION_SOURCES,
    type PayrollDeductionRule, type DeductionDraft,
} from "./payroll-deductions"
import { buildEntry, type PersonMonth } from "./register"
import { timelineForMonth, type EmploymentEventRow } from "./employment"
import { toMinor, formatMinor } from "./payroll"

/**
 * Payroll deductions (LATER_CHANGES_PLAN.md §7.12, PR 440): income tax,
 * social insurance and the company's own, each a percentage of the month's
 * pay before them or a fixed amount, each a line of its own.
 */

const tax = (value: number): PayrollDeductionRule => ({ id: "d-tax", kind: "INCOME_TAX", name: null, basis: "PERCENT", value, sortOrder: 0 })
const insurance = (value: number): PayrollDeductionRule => ({ id: "d-ins", kind: "SOCIAL_INSURANCE", name: null, basis: "PERCENT", value, sortOrder: 0 })
const other = (id: string, name: string, basis: "PERCENT" | "AMOUNT", value: number, sortOrder: number): PayrollDeductionRule =>
    ({ id, kind: "OTHER", name, basis, value, sortOrder })

describe("a percentage is of the month's pay before the deductions", () => {
    it("is worked out to two decimals, half up", () => {
        expect(percentOf(toMinor(10_000), 10)).toBe(toMinor(1_000))
        expect(percentOf(toMinor(1_234.56), 12.5)).toBe(toMinor(154.32))
        // 0.05 at 10% is 0.005: half up, a piastre.
        expect(percentOf(5, 10)).toBe(1)
        // 0.04 at 10% is 0.004: down.
        expect(percentOf(4, 10)).toBe(0)
        expect(percentOf(toMinor(9_999.99), 0.01)).toBe(100)
        expect(percentOf(toMinor(100), 0)).toBe(0)
        expect(percentOf(toMinor(100), 100)).toBe(toMinor(100))
    })

    it("takes each percentage of the same pay, not of what the one before left", () => {
        const lines = deductionLines(toMinor(10_000), [tax(10), insurance(11)])
        expect(lines.map(l => formatMinor(l.amountMinor))).toEqual(["1000.00", "1100.00"])
    })

    it("takes a fixed amount as it is", () => {
        const lines = deductionLines(toMinor(10_000), [other("d1", "Union fee", "AMOUNT", 150, 0)])
        expect(lines).toEqual([expect.objectContaining({ kind: "DEDUCTION", label: "Union fee", amountMinor: toMinor(150) })])
    })

    it("takes no more than what's left, so the net never goes below 0", () => {
        const lines = deductionLines(toMinor(1_000), [
            tax(50), insurance(40), other("d1", "Union fee", "AMOUNT", 300, 0), other("d2", "Club", "AMOUNT", 50, 1),
        ])
        // 500 and 400 leave 100: the fee takes the 100, and the club has nothing left.
        expect(lines.map(l => [l.label, formatMinor(l.amountMinor)])).toEqual([
            ["Income tax", "500.00"], ["Social insurance", "400.00"], ["Union fee", "100.00"],
        ])
        expect(lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(toMinor(1_000))
    })

    it("takes nothing from a month that pays nothing", () => {
        expect(deductionLines(0, [tax(10), other("d1", "Union fee", "AMOUNT", 150, 0)])).toEqual([])
    })

    it("prints nothing for a deduction at 0", () => {
        expect(deductionLines(toMinor(10_000), [tax(0), insurance(0), other("d1", "Union fee", "AMOUNT", 0, 0)])).toEqual([])
    })
})

describe("each is a line of its own, traceable to what it is", () => {
    it("puts income tax, then social insurance, then the others in the card's order", () => {
        const rules = [other("d2", "Club", "AMOUNT", 10, 1), insurance(5), other("d1", "Union fee", "AMOUNT", 20, 0), tax(10)]
        expect(orderedDeductions(rules).map(r => r.kind === "OTHER" ? r.name : r.kind)).toEqual(["INCOME_TAX", "SOCIAL_INSURANCE", "Union fee", "Club"])
        expect(deductionLines(toMinor(10_000), rules).map(l => l.label)).toEqual(["Income tax", "Social insurance", "Union fee", "Club"])
    })

    it("names where each came from, so a page can say it in its own language", () => {
        const lines = deductionLines(toMinor(10_000), [tax(10), insurance(5), other("d1", "Union fee", "AMOUNT", 20, 0)])
        expect(lines.map(l => [l.source, l.sourceId])).toEqual([
            [PAYROLL_DEDUCTION_SOURCES.INCOME_TAX, "d-tax"],
            [PAYROLL_DEDUCTION_SOURCES.SOCIAL_INSURANCE, "d-ins"],
            [PAYROLL_DEDUCTION_SOURCES.OTHER, "d1"],
        ])
        expect(deductionSource("INCOME_TAX")).toBe("INCOME_TAX")
        expect(deductionSource("SOCIAL_INSURANCE")).toBe("SOCIAL_INSURANCE")
        expect(deductionSource("OTHER")).toBe("PAYROLL_DEDUCTION")
    })
})

describe("what an approved month keeps", () => {
    it("is the deductions it was approved with, as stored", () => {
        const rules = [tax(10), other("d1", "Union fee", "AMOUNT", 150, 0)]
        expect(deductionsKept(JSON.parse(JSON.stringify(rules)))).toEqual(rules)
    })

    it("is none for a month approved before there were any, or a row that isn't one", () => {
        expect(deductionsKept(null)).toEqual([])
        expect(deductionsKept(undefined)).toEqual([])
        expect(deductionsKept({})).toEqual([])
        expect(deductionsKept([{ id: "x", kind: "VAT", basis: "PERCENT", value: 5 }, { id: "y", kind: "OTHER", basis: "PERCENT", value: "5" }])).toEqual([])
    })
})

describe("what the card says is wrong, before anything is sent", () => {
    const draft = (over: Partial<DeductionDraft> = {}): DeductionDraft => ({ name: "Union fee", basis: "AMOUNT", value: "150", ...over })

    it("takes what's right", () => {
        expect(deductionErrors({ incomeTax: "10", socialInsurance: "11.25", more: [draft(), draft({ name: "Club", basis: "PERCENT", value: "2.5" })] })).toEqual({})
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: [] })).toEqual({})
        expect(deductionErrors({ incomeTax: "100", socialInsurance: "0.01", more: [] })).toEqual({})
    })

    it("says a percentage is 0 to 100, with up to two decimals", () => {
        expect(deductionErrors({ incomeTax: "100.5", socialInsurance: "0", more: [] })).toEqual({ incomeTax: "deduction_percent_invalid" })
        expect(deductionErrors({ incomeTax: "-1", socialInsurance: "", more: [] })).toEqual({ incomeTax: "deduction_percent_invalid", socialInsurance: "deduction_percent_invalid" })
        expect(deductionErrors({ incomeTax: "1.234", socialInsurance: "abc", more: [] })).toEqual({ incomeTax: "deduction_percent_invalid", socialInsurance: "deduction_percent_invalid" })
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: [draft({ basis: "PERCENT", value: "101" })] })).toEqual({ more: { 0: { value: "deduction_percent_invalid" } } })
    })

    it("says an amount is 0 or more, with up to two decimals", () => {
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: [draft({ value: "-5" })] })).toEqual({ more: { 0: { value: "deduction_amount_invalid" } } })
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: [draft({ value: "1.005" })] })).toEqual({ more: { 0: { value: "deduction_amount_invalid" } } })
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: [draft({ value: "" })] })).toEqual({ more: { 0: { value: "deduction_amount_invalid" } } })
    })

    it("needs a name, up to its length, and two can't share one", () => {
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: [draft({ name: "  " })] })).toEqual({ more: { 0: { name: "deduction_name_required" } } })
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: [draft({ name: "x".repeat(DEDUCTION_NAME_MAX + 1) })] })).toEqual({ more: { 0: { name: "deduction_name_too_long" } } })
        // Ignoring capitals and the spaces around it.
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: [draft(), draft({ name: " union FEE " })] })).toEqual({ more: { 1: { name: "deduction_name_taken" } } })
    })

    it("reads Arabic digits and the Arabic decimal mark as Western ones", () => {
        expect(figure(" ١٠٫٥ ")).toBe("10.5")
        expect(figure("۱۲")).toBe("12")
        expect(deductionErrors({ incomeTax: "١٠٫٥", socialInsurance: "١١", more: [draft({ value: "١٥٠" })] })).toEqual({})
        expect(deductionErrors({ incomeTax: "١٠١", socialInsurance: "0", more: [] })).toEqual({ incomeTax: "deduction_percent_invalid" })
    })

    it("holds no more than its most", () => {
        const many = Array.from({ length: MAX_MORE_DEDUCTIONS + 1 }, (_, i) => draft({ name: `Fee ${i}` }))
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: many })).toEqual({ moreCount: "deduction_too_many" })
        expect(deductionErrors({ incomeTax: "0", socialInsurance: "0", more: many.slice(0, MAX_MORE_DEDUCTIONS) })).toEqual({})
    })
})

/** September 2026: 30 days. 30,000 a month is 1,000 a day. */
const HIRED = { type: "HIRED", effectiveFrom: new Date(0) } as EmploymentEventRow
const person = (over: Partial<PersonMonth> = {}): PersonMonth => ({
    userId: "u1",
    name: "Mona Fahmy",
    timeline: timelineForMonth([HIRED], 2026, 9, "Africa/Cairo"),
    rates: [{ fromDay: 1, monthlyMinor: toMinor(30_000) }],
    adjustments: [],
    ...over,
})

describe("on a payslip", () => {
    it("changes nothing where the company has none", () => {
        const before = buildEntry(person())
        expect(buildEntry(person({ payrollDeductions: [] })).lines).toEqual(before.lines)
        expect(buildEntry(person({ payrollDeductions: [tax(0), insurance(0)] })).lines).toEqual(before.lines)
    })

    it("comes after Nizmo's own deductions, and takes its percentage of what they leave", () => {
        const entry = buildEntry(person({
            // Two days' deduction: 2,000. And two days' bonus: 2,000 more.
            adjustments: [
                { type: "DEDUCTION", days: 2, source: "MANUAL" },
                { type: "BONUS", days: 2, source: "MANUAL" },
            ],
            attendance: { lateness: toMinor(500), earlyLeave: 0, absence: 0, overtime: toMinor(1_500), missionAllowance: 0 },
            payrollDeductions: [tax(10), insurance(11)],
        }))
        // Pay before them: 30,000 + 2,000 + 1,500 − 2,000 − 500 = 31,000.
        const deductions = entry.lines.filter(l => l.source === "INCOME_TAX" || l.source === "SOCIAL_INSURANCE")
        expect(deductions.map(l => formatMinor(l.amountMinor))).toEqual(["3100.00", "3410.00"])
        // After everything else on the payslip.
        const last = entry.lines.slice(-2)
        expect(last.map(l => l.source)).toEqual(["INCOME_TAX", "SOCIAL_INSURANCE"])
        expect(formatMinor(entry.totals.netMinor)).toBe("24490.00")
    })

    it("comes before a debt's recovery, which works on what's left after them", () => {
        const entry = buildEntry(person({
            payrollDeductions: [tax(10)],
            debts: [{ id: "debt-1", outstandingMinor: toMinor(100_000), dueDate: new Date(Date.UTC(2026, 0, 1)) }],
            // Half the net: of 27,000 after tax, 13,500.
            recoveryCapPercent: 50,
        }))
        expect(entry.lines.map(l => l.source)).toEqual(["SALARY", "INCOME_TAX", "DEBT_RECOVERY"])
        expect(formatMinor(entry.lines[1].amountMinor)).toBe("3000.00")
        expect(formatMinor(entry.lines[2].amountMinor)).toBe("13500.00")
        expect(formatMinor(entry.totals.netMinor)).toBe("13500.00")
    })

    it("never takes the net below 0 or leaves a debt", () => {
        const entry = buildEntry(person({
            adjustments: [{ type: "DEDUCTION", days: 29, source: "MANUAL" }],
            payrollDeductions: [tax(10), other("d1", "Union fee", "AMOUNT", 5_000, 0)],
        }))
        // 1,000 left: 100 in tax, and the fee takes the other 900.
        expect(entry.lines.filter(l => l.source === "INCOME_TAX" || l.source === "PAYROLL_DEDUCTION").map(l => formatMinor(l.amountMinor))).toEqual(["100.00", "900.00"])
        expect(entry.totals.netMinor).toBe(0)
        expect(entry.totals.carriedMinor).toBe(0)
    })

    it("takes nothing from a month whose own deductions already took it all", () => {
        const entry = buildEntry(person({
            adjustments: [{ type: "DEDUCTION", days: 31, source: "MANUAL" }],
            payrollDeductions: [tax(10), other("d1", "Union fee", "AMOUNT", 50, 0)],
        }))
        expect(entry.lines.some(l => l.source === "INCOME_TAX" || l.source === "PAYROLL_DEDUCTION")).toBe(false)
        // What Nizmo's own deduction went over by is still carried, as before.
        expect(formatMinor(entry.totals.carriedMinor)).toBe("1000.00")
    })

    it("takes nothing from someone left out of the month, as nothing is paid", () => {
        const entry = buildEntry(person({ exclusion: { reason: "On unpaid leave" }, payrollDeductions: [tax(10)] }))
        expect(entry.lines.map(l => l.source)).toEqual(["SALARY"])
    })
})
