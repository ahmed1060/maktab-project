import { describe, it, expect } from "vitest"
import {
    ADVANCE_MONTHS, advanceCheck, consentWords, installmentLimit, installmentsOf, largestInstallment, leastMonths, moneyText, netPayOf, otherDebtsOf,
    payrollMonthKey, serviceFrom, type AdvanceOffer,
} from "./salary-advance"
import type { PayrollDeductionRule } from "./payroll-deductions"

/**
 * Asking for a salary advance (LATER_CHANGES_PLAN.md §7.5, step 3a; DESIGN.md
 * §5.5, Asking for a salary advance): its installments, the limits measured
 * against the net pay, and what's said under each field, as the dialog and
 * the server read them alike. Made-up figures.
 */

const rule = (kind: PayrollDeductionRule["kind"], value: number, basis: PayrollDeductionRule["basis"] = "PERCENT"): PayrollDeductionRule =>
    ({ id: kind, kind, name: kind === "OTHER" ? "Union" : null, basis, value, sortOrder: 0 })

/** A month's salary of 10,000.00, 18,000.00 net, as the dialog is offered it. */
const offer = (over: Partial<AdvanceOffer> = {}): AdvanceOffer => ({
    closed: null,
    salaryMinor: 2_000_000,
    netMinor: 1_800_000,
    otherDebtsMinor: 0,
    maxAmountMinor: 4_000_000,
    maxMonths: 2,
    installmentPercent: 10,
    debtsPercent: 25,
    overLimit: "BLOCK",
    firsts: [{ year: 2026, month: 11 }, { year: 2026, month: 12 }],
    approved: null,
    ...over,
})

describe("when the months worked first are up", () => {
    it("is so many months after the contract starts, the same day", () => {
        expect(serviceFrom("2026-11-15", 3)).toBe("2027-02-15")
        expect(serviceFrom("2026-01-01", 0)).toBe("2026-01-01")
        expect(serviceFrom("2026-05-10", 120)).toBe("2036-05-10")
    })

    it("is that month's last day where it has fewer", () => {
        expect(serviceFrom("2026-11-30", 3)).toBe("2027-02-28")
        expect(serviceFrom("2027-08-31", 6)).toBe("2028-02-29")
    })
})

describe("a salary advance's installments", () => {
    it("are the amount over the months, down to the piastre, the last taking the rounding", () => {
        const list = installmentsOf(1_000_000, 6, { year: 2026, month: 11 })
        expect(list.map(i => i.amountMinor)).toEqual([166_666, 166_666, 166_666, 166_666, 166_666, 166_670])
        expect(list.reduce((sum, i) => sum + i.amountMinor, 0)).toBe(1_000_000)
    })

    it("run month by month from the first, over the year's end", () => {
        expect(installmentsOf(300_000, 3, { year: 2026, month: 11 }).map(i => payrollMonthKey(i))).toEqual(["2026-11", "2026-12", "2027-01"])
    })

    it("are one, for one month", () => {
        expect(installmentsOf(123_456, 1, { year: 2027, month: 2 })).toEqual([{ year: 2027, month: 2, amountMinor: 123_456 }])
    })

    it("have the last as the largest", () => {
        expect(largestInstallment(1_000_000, 6)).toBe(166_670)
        expect(largestInstallment(1_200_000, 6)).toBe(200_000)
    })
})

describe("the net pay the limits are measured against", () => {
    it("is the monthly salary less the payroll deductions, each of the salary", () => {
        expect(netPayOf(2_000_000, [rule("INCOME_TAX", 10), rule("SOCIAL_INSURANCE", 11)])).toBe(1_580_000)
    })

    it("takes a fixed amount as it is", () => {
        expect(netPayOf(2_000_000, [rule("OTHER", 500, "AMOUNT")])).toBe(1_950_000)
    })

    it("is never below 0", () => {
        expect(netPayOf(100_000, [rule("OTHER", 5_000, "AMOUNT")])).toBe(0)
    })

    it("is the whole salary with no deductions", () => {
        expect(netPayOf(2_000_000, [])).toBe(2_000_000)
    })
})

describe("their other debts, a month of them", () => {
    it("are what's still owed, up to the share a payslip takes for debts", () => {
        expect(otherDebtsOf({ owedMinor: 500_000, netMinor: 1_800_000, recoveryPercent: 100, installmentsMinor: 0 })).toBe(500_000)
        expect(otherDebtsOf({ owedMinor: 500_000, netMinor: 1_800_000, recoveryPercent: 20, installmentsMinor: 0 })).toBe(360_000)
    })

    it("count the installments of their other open advances", () => {
        expect(otherDebtsOf({ owedMinor: 0, netMinor: 1_800_000, recoveryPercent: 100, installmentsMinor: 90_000 })).toBe(90_000)
    })
})

describe("the most an installment may be", () => {
    it("is the installment's share of the net pay, with no other debts", () => {
        expect(installmentLimit(offer())).toEqual({ capMinor: 180_000, by: "INSTALLMENT" })
    })

    it("is what all debts together leave, where that's less", () => {
        // 25% of 18,000.00 is 4,500.00; 3,300.00 of it taken leaves 1,200.00.
        expect(installmentLimit(offer({ otherDebtsMinor: 330_000 }))).toEqual({ capMinor: 120_000, by: "DEBTS" })
    })

    it("is never below 0", () => {
        expect(installmentLimit(offer({ otherDebtsMinor: 900_000 })).capMinor).toBe(0)
    })
})

describe("the fewest months the limits allow", () => {
    it("is the first whose largest installment fits", () => {
        // 9,000.00 at 1,800.00 a month is 5 months.
        expect(leastMonths(900_000, 180_000)).toBe(5)
        expect(leastMonths(900_001, 180_000)).toBe(6)
    })

    it("is one where the whole fits in a month", () => {
        expect(leastMonths(100_000, 180_000)).toBe(1)
    })

    it("is none where 24 months can't pay it back", () => {
        expect(leastMonths(180_000 * 24 + 1, 180_000)).toBeNull()
        expect(leastMonths(180_000 * 24, 180_000)).toBe(24)
    })
})

describe("what's said under each field", () => {
    it("is nothing for an amount and months within everything", () => {
        expect(advanceCheck({ amount: "9000", months: "5", first: "2026-12" }, offer())).toEqual({
            errors: {}, amountMinor: 900_000, months: 5, over: { installment: false, debts: false },
        })
    })

    it("refuses an amount that isn't one", () => {
        for (const amount of ["", "0", "-5", "abc", "10.123", "1e3"]) {
            expect(advanceCheck({ amount, months: "5", first: "2026-12" }, offer()).errors.amount).toBe("salary_advance_ask_amount_invalid")
        }
    })

    it("reads Arabic digits as digits", () => {
        expect(advanceCheck({ amount: "٩٠٠٠", months: "٥", first: "2026-12" }, offer()).amountMinor).toBe(900_000)
    })

    it("refuses more than the most one may ask for", () => {
        expect(advanceCheck({ amount: "40000.01", months: "24", first: "2026-12" }, offer()).errors.amount).toBe("salary_advance_ask_amount_over")
        expect(advanceCheck({ amount: "40000", months: "24", first: "2026-12" }, offer()).errors.amount).toBeUndefined()
    })

    it("refuses months outside 1 to 24, or not whole", () => {
        for (const months of ["", "0", "25", "1.5", "x"]) {
            expect(advanceCheck({ amount: "100", months, first: "2026-12" }, offer()).errors.months).toBe("salary_advance_ask_months_invalid")
        }
        expect(ADVANCE_MONTHS).toEqual({ min: 1, max: 24 })
    })

    it("refuses a first installment that isn't offered", () => {
        expect(advanceCheck({ amount: "100", months: "1", first: "2027-01" }, offer()).errors.first).toBe("salary_advance_ask_first_invalid")
    })

    it("with Block, refuses fewer months than the limits allow", () => {
        const check = advanceCheck({ amount: "9000", months: "4", first: "2026-12" }, offer())
        expect(check.errors.months).toBe("salary_advance_ask_months_few")
        expect(check.over).toEqual({ installment: true, debts: false })
    })

    it("with Block, refuses an amount 24 months can't pay back, under the amount", () => {
        const check = advanceCheck({ amount: "40000", months: "24", first: "2026-12" }, offer({ otherDebtsMinor: 330_000 }))
        expect(check.errors.amount).toBe("salary_advance_ask_amount_unpayable")
        expect(check.errors.months).toBeUndefined()
    })

    it("with Warn, lets fewer months through, saying which limit each is over", () => {
        const check = advanceCheck({ amount: "9000", months: "4", first: "2026-12" }, offer({ overLimit: "WARN" }))
        expect(check.errors).toEqual({})
        expect(check.over).toEqual({ installment: true, debts: false })
        const both = advanceCheck({ amount: "9000", months: "2", first: "2026-12" }, offer({ overLimit: "WARN", otherDebtsMinor: 330_000 }))
        expect(both.over).toEqual({ installment: true, debts: true })
    })

    it("with Warn, lets an amount 24 months can't pay back within the limits through", () => {
        expect(advanceCheck({ amount: "40000", months: "24", first: "2026-12" }, offer({ overLimit: "WARN", otherDebtsMinor: 330_000 })).errors).toEqual({})
    })
})

describe("the consent's words", () => {
    it("say the amount, in the language's digits", () => {
        const en = consentWords({ salary_advance_consent: "Agree to {amount} EGP." }, 1_000_000, "en")
        expect(en).toBe("Agree to 10,000.00 EGP.")
        expect(consentWords({ salary_advance_consent: "{amount}" }, 1_000_000, "ar")).toBe(moneyText(1_000_000, "ar"))
        expect(moneyText(1_000_000, "ar")).toMatch(/[٠-٩]/)
    })
})
