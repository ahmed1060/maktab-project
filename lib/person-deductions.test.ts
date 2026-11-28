import { describe, it, expect } from "vitest"
import {
    deductionLines, rulesFor, personDeductionErrors, peopleKept, peopleStored,
    type PayrollDeductionRule, type PersonDeductionSetting,
} from "./payroll-deductions"

/**
 * A person's payroll deductions (LATER_CHANGES_PLAN.md §7.12, 9b; DESIGN.md
 * §5.5, A person's payroll deductions): each of the company's as the company
 * takes it, their own figure in its place, or not applied. Pure: the rules
 * payroll and the card share. Made-up figures.
 */

const TAX: PayrollDeductionRule = { id: "tax", kind: "INCOME_TAX", name: null, basis: "PERCENT", value: 10, sortOrder: 0 }
const INSURANCE: PayrollDeductionRule = { id: "ins", kind: "SOCIAL_INSURANCE", name: null, basis: "PERCENT", value: 11, sortOrder: 0 }
const FEE: PayrollDeductionRule = { id: "fee", kind: "OTHER", name: "Union fee", basis: "AMOUNT", value: 150, sortOrder: 0 }
const CLUB: PayrollDeductionRule = { id: "club", kind: "OTHER", name: "Club", basis: "PERCENT", value: 1, sortOrder: 1 }
const COMPANY = [TAX, INSURANCE, FEE, CLUB]

const own = (deductionId: string, value: number): PersonDeductionSetting => ({ deductionId, mode: "OWN", value })
const none = (deductionId: string): PersonDeductionSetting => ({ deductionId, mode: "NONE", value: null })

describe("the company's deductions, as they reach one person", () => {
    it("are the company's where nothing's set for them", () => {
        expect(rulesFor(COMPANY)).toEqual(COMPANY)
        expect(rulesFor(COMPANY, [])).toEqual(COMPANY)
    })

    it("take their own figure in the company's place, the rest as it is", () => {
        expect(rulesFor(COMPANY, [own("tax", 12.5), own("fee", 50)])).toEqual([
            { ...TAX, value: 12.5 }, INSURANCE, { ...FEE, value: 50 }, CLUB,
        ])
    })

    it("leave out one not applied to them", () => {
        expect(rulesFor(COMPANY, [none("ins"), none("club")])).toEqual([TAX, FEE])
    })

    it("ignore what's set for a deduction the company no longer has", () => {
        expect(rulesFor([TAX], [own("gone", 5), none("also-gone")])).toEqual([TAX])
    })

    it("their own at 0 takes nothing, as the company's at 0 does", () => {
        const lines = deductionLines(3_000_000, rulesFor(COMPANY, [own("tax", 0)]))
        expect(lines.map(l => l.source)).toEqual(["SOCIAL_INSURANCE", "PAYROLL_DEDUCTION", "PAYROLL_DEDUCTION"])
    })

    it("make the payslip's lines from their own, in the company's order", () => {
        const lines = deductionLines(3_000_000, rulesFor(COMPANY, [own("tax", 12.5), none("ins"), own("fee", 50)]))
        expect(lines.map(l => [l.label, l.amountMinor / 100])).toEqual([
            ["Income tax", 3750], ["Union fee", 50], ["Club", 300],
        ])
    })
})

describe("what the person's card refuses", () => {
    const entry = (ref: string, basis: "PERCENT" | "AMOUNT", mode: "COMPANY" | "OWN" | "NONE", value = "") => ({ ref, basis, mode, value })

    it("nothing, as the company's or not applied, whatever's in the field", () => {
        expect(personDeductionErrors([entry("INCOME_TAX", "PERCENT", "COMPANY", "abc"), entry("fee", "AMOUNT", "NONE", "-1")])).toEqual({})
    })

    it("their own percentage 0 to 100 with up to two decimals, as the company's card does", () => {
        expect(personDeductionErrors([entry("INCOME_TAX", "PERCENT", "OWN", "12.5")])).toEqual({})
        expect(personDeductionErrors([entry("INCOME_TAX", "PERCENT", "OWN", "١٢٫٥")])).toEqual({})
        expect(personDeductionErrors([entry("INCOME_TAX", "PERCENT", "OWN", "100.01")])).toEqual({ INCOME_TAX: "deduction_percent_invalid" })
        expect(personDeductionErrors([entry("INCOME_TAX", "PERCENT", "OWN", "1.234")])).toEqual({ INCOME_TAX: "deduction_percent_invalid" })
        expect(personDeductionErrors([entry("INCOME_TAX", "PERCENT", "OWN", "")])).toEqual({ INCOME_TAX: "deduction_percent_invalid" })
    })

    it("their own amount 0 or more, with up to two decimals", () => {
        expect(personDeductionErrors([entry("fee", "AMOUNT", "OWN", "1500")])).toEqual({})
        expect(personDeductionErrors([entry("fee", "AMOUNT", "OWN", "-5")])).toEqual({ fee: "deduction_amount_invalid" })
        expect(personDeductionErrors([entry("fee", "AMOUNT", "OWN", "")])).toEqual({ fee: "deduction_amount_invalid" })
    })

    it("each under its own deduction", () => {
        expect(personDeductionErrors([
            entry("INCOME_TAX", "PERCENT", "OWN", "200"), entry("SOCIAL_INSURANCE", "PERCENT", "OWN", "5"), entry("fee", "AMOUNT", "OWN", "x"),
        ])).toEqual({ INCOME_TAX: "deduction_percent_invalid", fee: "deduction_amount_invalid" })
    })
})

describe("what an approved month keeps of each person's", () => {
    it("is stored by person and read back as it was", () => {
        const people = new Map([["e1", [own("tax", 12.5), none("ins")]], ["e2", [own("fee", 50)]]])
        const stored = peopleStored(people)
        expect(JSON.parse(JSON.stringify(stored))).toEqual({ e1: [own("tax", 12.5), none("ins")], e2: [own("fee", 50)] })
        expect(peopleKept(JSON.parse(JSON.stringify(stored)))).toEqual(people)
    })

    it("is nobody's for a month approved before, which kept none", () => {
        expect(peopleKept(null)).toEqual(new Map())
        expect(peopleKept(undefined)).toEqual(new Map())
        expect(peopleKept([])).toEqual(new Map())
    })

    it("drops what isn't a setting", () => {
        expect(peopleKept({ e1: [own("tax", 5), { deductionId: "x", mode: "MAYBE" }, { mode: "OWN", value: 1 }, own("fee", Number.NaN)], e2: "no" }))
            .toEqual(new Map([["e1", [own("tax", 5)]]]))
    })
})
