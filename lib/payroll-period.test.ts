import { describe, it, expect } from "vitest"
import { periodFromAddress, addressWithPeriod, yearsAround } from "./payroll-period"

/**
 * Which month Payroll is about lives in its address (DESIGN.md §5.3,
 * decided on 2026-10-31), so a reload or a link opens on it.
 */
const NOW = new Date(2026, 9, 15)
const params = (query: string) => new URLSearchParams(query)

describe("the period a page's address names", () => {
    it("is the year and month it says", () => {
        expect(periodFromAddress(params("year=2025&month=3"), NOW)).toEqual({ year: 2025, month: 3 })
    })

    it("is this month when it names none", () => {
        expect(periodFromAddress(params(""), NOW)).toEqual({ year: 2026, month: 10 })
    })

    it("takes each part on its own: a month alone is that month this year", () => {
        expect(periodFromAddress(params("month=3"), NOW)).toEqual({ year: 2026, month: 3 })
        expect(periodFromAddress(params("year=2025"), NOW)).toEqual({ year: 2025, month: 10 })
    })

    it("ignores what isn't a month or a year it could be", () => {
        for (const query of ["month=13", "month=0", "month=2.5", "month=march", "year=abc", "year=99", "year=20260"]) {
            expect(periodFromAddress(params(query), NOW)).toEqual({ year: 2026, month: 10 })
        }
    })
})

describe("the address with a period in it", () => {
    it("sets the year and month and keeps the rest, the top bar's company among them", () => {
        expect(addressWithPeriod("/dashboard/payroll", "company=Delta+Sites", 2026, 9)).toBe("/dashboard/payroll?company=Delta+Sites&year=2026&month=9")
        expect(addressWithPeriod("/dashboard/payroll", "year=2025&month=3&company=Delta+Sites", 2026, 9)).toBe("/dashboard/payroll?year=2026&month=9&company=Delta+Sites")
        expect(addressWithPeriod("/dashboard/payroll", "", 2026, 9)).toBe("/dashboard/payroll?year=2026&month=9")
    })
})

describe("the years offered", () => {
    it("are two either side of this one", () => {
        expect(yearsAround(2026)).toEqual([2024, 2025, 2026, 2027, 2028])
    })

    it("include one a link opened that's further off, in its place", () => {
        expect(yearsAround(2026, 2019)).toEqual([2019, 2024, 2025, 2026, 2027, 2028])
        expect(yearsAround(2026, 2031)).toEqual([2024, 2025, 2026, 2027, 2028, 2031])
        expect(yearsAround(2026, 2025)).toEqual([2024, 2025, 2026, 2027, 2028])
    })
})
