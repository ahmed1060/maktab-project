import { describe, it, expect } from "vitest"
import { periodFromAddress, addressWithPeriod, yearFromAddress, addressWithYear, yearsAround, dayFromAddress, addressWithDay } from "./period-address"

/**
 * Which period a page is about lives in its address (DESIGN.md §5.3,
 * decided on 2026-10-31), so a reload or a link opens on it: Payroll's
 * month, and Public holidays' year.
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

describe("a year alone, as Public holidays' (PR 146)", () => {
    it("is the year the address says, or this one when it names none it could be", () => {
        expect(yearFromAddress(params("year=2027"), NOW)).toBe(2027)
        expect(yearFromAddress(params(""), NOW)).toBe(2026)
        for (const query of ["year=abc", "year=99", "year=20260", "year=2026.5"]) expect(yearFromAddress(params(query), NOW)).toBe(2026)
    })

    it("goes in the address with the rest kept, and no month added", () => {
        expect(addressWithYear("/dashboard/public-holidays", "", 2027)).toBe("/dashboard/public-holidays?year=2027")
        expect(addressWithYear("/dashboard/public-holidays", "year=2025&company=Delta+Sites", 2027)).toBe("/dashboard/public-holidays?year=2027&company=Delta+Sites")
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

describe("a day of the month, as Attendance's punches' (PR 150)", () => {
    const params = (search: string) => new URLSearchParams(search)

    it("is the day the address names, when the month has it", () => {
        expect(dayFromAddress(params("year=2026&month=10&day=15"), 2026, 10)).toBe(15)
        expect(dayFromAddress(params("day=31"), 2026, 10)).toBe(31)
    })

    it("is every day when the address names none, or one the month hasn't", () => {
        expect(dayFromAddress(params(""), 2026, 10)).toBeNull()
        expect(dayFromAddress(params("day=31"), 2026, 11)).toBeNull()
        expect(dayFromAddress(params("day=29"), 2026, 2)).toBeNull()
        expect(dayFromAddress(params("day=29"), 2028, 2)).toBe(29)
        for (const bad of ["0", "-1", "1.5", "abc", "015x"]) expect(dayFromAddress(params(`day=${bad}`), 2026, 10)).toBeNull()
    })

    it("goes into the address, the rest kept, and out of it for every day", () => {
        expect(addressWithDay("/dashboard/attendance", "tab=punches&year=2026&month=10", 15)).toBe("/dashboard/attendance?tab=punches&year=2026&month=10&day=15")
        expect(addressWithDay("/dashboard/attendance", "tab=punches&day=15&company=Delta+Sites", null)).toBe("/dashboard/attendance?tab=punches&company=Delta+Sites")
    })
})
