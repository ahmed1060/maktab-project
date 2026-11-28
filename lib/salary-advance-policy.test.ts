import { describe, it, expect } from "vitest"
import {
    SALARY_ADVANCE_POLICY_DEFAULTS, draftOfPolicy, policyOfDraft, policyUnchanged, salaryAdvancePolicyErrors,
    type SalaryAdvancePolicyDraft,
} from "./salary-advance-policy"

/**
 * The rules a salary advance follows (LATER_CHANGES_PLAN.md §7.5, step 2;
 * DESIGN.md §5.5, Salary advances): what Company Settings' card holds, and
 * what's wrong with what's typed, said by the card and refused by the server
 * by the same rules.
 */

const draft = (patch: Partial<SalaryAdvancePolicyDraft> = {}): SalaryAdvancePolicyDraft => ({ ...draftOfPolicy(SALARY_ADVANCE_POLICY_DEFAULTS), ...patch })
const wrong = (patch: Partial<SalaryAdvancePolicyDraft>) => salaryAdvancePolicyErrors(draft(patch))

describe("unless changed", () => {
    it("is 2 months' salary, after 3 months, one at a time, 10% an installment, 25% for all debts, and Block", () => {
        expect(SALARY_ADVANCE_POLICY_DEFAULTS).toEqual({
            maxMonths: 2, minServiceMonths: 3, oneOpen: true, installmentPercent: 10, debtsPercent: 25, overLimit: "BLOCK",
        })
    })

    it("has nothing wrong", () => {
        expect(salaryAdvancePolicyErrors(draft())).toEqual({})
    })
})

describe("the most one may ask for", () => {
    it("is from 0.5 to 12 months, with up to two decimals", () => {
        for (const ok of ["0.5", "1", "1.25", "12", " 3 "]) expect(wrong({ maxMonths: ok }), ok).toEqual({})
        for (const no of ["0", "0.4", "12.01", "13", "1.255", "", "two", "-1", "1e1"]) {
            expect(wrong({ maxMonths: no }), no).toEqual({ maxMonths: "salary_advance_months_invalid" })
        }
    })

    it("reads Arabic digits and the Arabic decimal mark", () => {
        expect(wrong({ maxMonths: "١٫٥" })).toEqual({})
        expect(policyOfDraft(draft({ maxMonths: "١٫٥" })).maxMonths).toBe(1.5)
    })
})

describe("the months worked first", () => {
    it("is a whole number from 0 to 120", () => {
        for (const ok of ["0", "3", "120", "٦"]) expect(wrong({ minServiceMonths: ok }), ok).toEqual({})
        for (const no of ["121", "1.5", "", "-1", "three"]) {
            expect(wrong({ minServiceMonths: no }), no).toEqual({ minServiceMonths: "salary_advance_service_invalid" })
        }
    })
})

describe("the two percentages", () => {
    it("are each from 1 to 100, with up to two decimals", () => {
        for (const ok of ["1", "12.5", "33.33", "100"]) {
            expect(wrong({ installmentPercent: ok, debtsPercent: "100" }), ok).toEqual({})
        }
        for (const no of ["0", "0.99", "100.01", "12.555", "", "ten"]) {
            expect(wrong({ installmentPercent: no }), no).toEqual({ installmentPercent: "salary_advance_percent_invalid" })
            expect(wrong({ debtsPercent: no }), no).toEqual({ debtsPercent: "salary_advance_percent_invalid" })
        }
    })

    it("never have all debts together below an installment's", () => {
        expect(wrong({ installmentPercent: "30", debtsPercent: "25" })).toEqual({ debtsPercent: "salary_advance_debts_below" })
        expect(wrong({ installmentPercent: "25", debtsPercent: "25" })).toEqual({})
        expect(wrong({ installmentPercent: "25.5", debtsPercent: "25.49" })).toEqual({ debtsPercent: "salary_advance_debts_below" })
    })

    it("say only what's wrong with an installment typed wrong, not that all debts are below it", () => {
        expect(wrong({ installmentPercent: "120", debtsPercent: "25" })).toEqual({ installmentPercent: "salary_advance_percent_invalid" })
    })
})

describe("what's on the card", () => {
    it("is the policy, as text, and back", () => {
        const policy = { maxMonths: 1.5, minServiceMonths: 0, oneOpen: false, installmentPercent: 12.5, debtsPercent: 30, overLimit: "WARN" as const }
        const d = draftOfPolicy(policy)
        expect(d).toEqual({ maxMonths: "1.5", minServiceMonths: "0", oneOpen: false, installmentPercent: "12.5", debtsPercent: "30", overLimit: "WARN" })
        expect(policyOfDraft(d)).toEqual(policy)
    })

    it("is unchanged where a figure's typed as the one saved", () => {
        const saved = SALARY_ADVANCE_POLICY_DEFAULTS
        expect(policyUnchanged(draft(), saved)).toBe(true)
        expect(policyUnchanged(draft({ maxMonths: "2.0", installmentPercent: "10.00", minServiceMonths: "03" }), saved)).toBe(true)
        expect(policyUnchanged(draft({ debtsPercent: "26" }), saved)).toBe(false)
        expect(policyUnchanged(draft({ oneOpen: false }), saved)).toBe(false)
        expect(policyUnchanged(draft({ overLimit: "WARN" }), saved)).toBe(false)
        // Emptied, it's a change, and said to be wrong when saved, even where 0 was saved.
        expect(policyUnchanged(draft({ maxMonths: "" }), saved)).toBe(false)
        const fromDayOne = { ...saved, minServiceMonths: 0 }
        expect(policyUnchanged({ ...draftOfPolicy(fromDayOne), minServiceMonths: "" }, fromDayOne)).toBe(false)
    })
})
