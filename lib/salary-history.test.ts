import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { effectiveFromChoice, ratesForMonth, rateAt, type SalaryChangeRow } from "./salary-history"
import { splitMonth, valueSegment, toMinor, formatMinor } from "./payroll"
import { calendarDateStr, startOfMonthIn } from "./time"
import { stripComments } from "./strip-comments"

const CAIRO = "Africa/Cairo"

/** A change as stored. Amounts are strings, as a Decimal column returns them. */
const change = (iso: string, amount: number, reason?: string, createdAt?: string): SalaryChangeRow => ({
    monthlyAmount: String(amount),
    effectiveFrom: new Date(iso),
    reason,
    createdAt: createdAt ? new Date(createdAt) : undefined,
})

/** Local month starts, so the fixtures read as the dates a person would say. */
const monthStart = (year: number, month: number) =>
    startOfMonthIn(new Date(Date.UTC(year, month - 1, 1, 12)), CAIRO)

describe("the prompt's answer becomes a date", () => {
    it("takes effect at the start of this month", () => {
        const now = new Date("2026-09-17T09:00:00Z")
        expect(calendarDateStr(effectiveFromChoice(now, "THIS_MONTH", CAIRO), CAIRO)).toBe("2026-09-01")
    })

    it("takes effect at the start of next month", () => {
        const now = new Date("2026-09-17T09:00:00Z")
        expect(calendarDateStr(effectiveFromChoice(now, "NEXT_MONTH", CAIRO), CAIRO)).toBe("2026-10-01")
    })

    it("rolls into January rather than month thirteen", () => {
        const now = new Date("2026-12-20T09:00:00Z")
        expect(calendarDateStr(effectiveFromChoice(now, "NEXT_MONTH", CAIRO), CAIRO)).toBe("2027-01-01")
    })

    it("works from the last day of a month", () => {
        // The off-by-one that a naive "add 31 days" would get wrong.
        const now = new Date("2026-09-30T20:00:00Z")
        expect(calendarDateStr(effectiveFromChoice(now, "THIS_MONTH", CAIRO), CAIRO)).toBe("2026-09-01")
        expect(calendarDateStr(effectiveFromChoice(now, "NEXT_MONTH", CAIRO), CAIRO)).toBe("2026-10-01")
    })

    it("works out of a short February", () => {
        const now = new Date("2026-02-27T09:00:00Z")
        expect(calendarDateStr(effectiveFromChoice(now, "NEXT_MONTH", CAIRO), CAIRO)).toBe("2026-03-01")
    })

    it("lands on local midnight, not UTC midnight", () => {
        // A change "effective 1 October" begins when October begins for the
        // company, not two or three hours later.
        const start = effectiveFromChoice(new Date("2026-09-17T09:00:00Z"), "NEXT_MONTH", CAIRO)
        expect(start.toISOString()).toBe("2026-09-30T21:00:00.000Z")
    })
})

describe("a month opens on the rate in force", () => {
    it("carries forward the latest change from before the month", () => {
        const rates = ratesForMonth([
            change("2020-01-01T00:00:00Z", 8_000),
            change("2026-06-01T00:00:00Z", 10_000),
        ], 2026, 9, CAIRO)

        expect(rates).toHaveLength(1)
        expect(rates[0]).toMatchObject({ fromDay: 1, monthlyMinor: toMinor(10_000) })
    })

    it("collapses every earlier change into one opening rate", () => {
        // Three prior changes must not become three day-1 rates: splitMonth
        // would emit empty segments and the payslip would carry lines for
        // stretches of zero days.
        const rates = ratesForMonth([
            change("2020-01-01T00:00:00Z", 6_000),
            change("2022-01-01T00:00:00Z", 8_000),
            change("2024-01-01T00:00:00Z", 9_000),
        ], 2026, 9, CAIRO)

        expect(rates).toHaveLength(1)
        expect(rates[0].monthlyMinor).toBe(toMinor(9_000))
    })

    it("refuses a month with no salary in force", () => {
        // Not a rate of zero — zero is a real salary somebody could be on. This
        // is a person with no history at all, and a payslip computed from a
        // guess is worse than one that will not compute.
        expect(() => ratesForMonth([change("2026-10-01T00:00:00Z", 10_000)], 2026, 9, CAIRO))
            .toThrow(/No salary in effect for 2026-09/)
        expect(() => ratesForMonth([], 2026, 9, CAIRO)).toThrow()
    })

    it("ignores a raise granted after the month", () => {
        // A payslip for September must not move because of a raise in October.
        // Reading the whole history without this filter is exactly how a closed
        // month silently changes value.
        const rates = ratesForMonth([
            change("2026-01-01T00:00:00Z", 10_000),
            change("2026-10-01T00:00:00Z", 12_000),
        ], 2026, 9, CAIRO)

        expect(rates).toHaveLength(1)
        expect(rates[0].monthlyMinor).toBe(toMinor(10_000))
    })
})

describe("a change inside the month keeps its own day", () => {
    it("splits the month where the change lands", () => {
        const mid = new Date(monthStart(2026, 9).getTime() + 15 * 24 * 3600 * 1000)
        expect(calendarDateStr(mid, CAIRO)).toBe("2026-09-16")

        const rates = ratesForMonth([
            change("2026-01-01T00:00:00Z", 10_000),
            { monthlyAmount: "12000", effectiveFrom: mid },
        ], 2026, 9, CAIRO)

        expect(rates.map(r => r.fromDay)).toEqual([1, 16])
    })

    it("feeds splitMonth to value the two halves at their own rates", () => {
        // The whole point of the phase, end to end: 10,000 for 1-15 and 12,000
        // for 16-30, each valued over September's thirty days.
        const mid = new Date(monthStart(2026, 9).getTime() + 15 * 24 * 3600 * 1000)
        const rates = ratesForMonth([
            change("2026-01-01T00:00:00Z", 10_000),
            { monthlyAmount: "12000", effectiveFrom: mid },
        ], 2026, 9, CAIRO)

        const segments = splitMonth(2026, 9, rates)
        expect(segments.map(s => [s.fromDay, s.toDay])).toEqual([[1, 15], [16, 30]])

        // 10,000 / 30 × 15 = 5,000.00 and 12,000 / 30 × 15 = 6,000.00.
        const total = segments.reduce((sum, s) => sum + valueSegment(s), 0)
        expect(formatMinor(total)).toBe("11000.00")
    })

    it("takes the later row when two changes share a date", () => {
        // A correction entered after the fact, on the same effective date. The
        // row written later is the one that meant to win.
        const rates = ratesForMonth([
            change("2026-09-01T00:00:00Z", 11_000, "typo", "2026-08-20T10:00:00Z"),
            change("2026-09-01T00:00:00Z", 10_000, "corrected", "2026-08-20T11:00:00Z"),
        ], 2026, 9, CAIRO)

        expect(rates).toHaveLength(1)
        expect(rates[0].monthlyMinor).toBe(toMinor(10_000))
        expect(rates[0].reason).toBe("corrected")
    })

    it("is not fooled by the order the rows arrive in", () => {
        const rates = ratesForMonth([
            change("2026-10-01T00:00:00Z", 12_000),
            change("2026-01-01T00:00:00Z", 10_000),
            change("2020-01-01T00:00:00Z", 8_000),
        ], 2026, 9, CAIRO)

        expect(rates).toHaveLength(1)
        expect(rates[0].monthlyMinor).toBe(toMinor(10_000))
    })
})

describe("the epoch backfill keeps every historical month computable", () => {
    it("is in force for any month you ask about", () => {
        // The migration seeds one row at the epoch for every existing user,
        // because User has no createdAt and there is no hire date to use.
        // Without it, every month before a person's first real change would
        // refuse to compute.
        const backfilled = [change("1970-01-01T00:00:00Z", 10_000, "Backfilled")]
        for (const [year, month] of [[2024, 1], [2025, 6], [2026, 9]] as const) {
            expect(ratesForMonth(backfilled, year, month, CAIRO)[0].monthlyMinor).toBe(toMinor(10_000))
        }
    })

    it("is superseded by the first real change", () => {
        const rates = ratesForMonth([
            change("1970-01-01T00:00:00Z", 10_000, "Backfilled"),
            change("2026-09-01T00:00:00Z", 12_000, "Raise"),
        ], 2026, 9, CAIRO)

        expect(rates).toHaveLength(1)
        expect(rates[0]).toMatchObject({ monthlyMinor: toMinor(12_000), reason: "Raise" })
    })
})

describe("the rate at an instant", () => {
    const history = [
        change("2020-01-01T00:00:00Z", 8_000),
        change("2026-06-01T00:00:00Z", 10_000),
        change("2026-10-01T00:00:00Z", 12_000),
    ]

    it("is the latest change on or before it", () => {
        expect(rateAt(history, new Date("2026-09-17T00:00:00Z"))?.monthlyAmount).toBe("10000")
    })

    it("does not see the future", () => {
        expect(rateAt(history, new Date("2026-05-31T00:00:00Z"))?.monthlyAmount).toBe("8000")
    })

    it("is null before any history exists", () => {
        expect(rateAt(history, new Date("2019-01-01T00:00:00Z"))).toBeNull()
    })
})

describe("the salary set last holds from its month's 1st", () => {
    // LATER_CHANGES_PLAN.md §7.13 (PR 437). Made-up people and amounts.
    // An account made without a salary is given 0 from the day it was made;
    // the salary set after it, for this month, is dated the 1st, before it.
    const startedAtZero = [
        change("2026-11-21T22:00:00Z", 0, "Starting salary", "2026-11-22T09:00:00Z"),
        change("2026-10-31T22:00:00Z", 9_000, "Raise", "2026-11-25T10:00:00Z"),
    ]

    it("isn't split at a starting salary entered before it and dated later", () => {
        const rates = ratesForMonth(startedAtZero, 2026, 11, CAIRO)
        expect(rates).toEqual([{ fromDay: 1, monthlyMinor: toMinor(9_000), reason: "Raise" }])
    })

    it("is one Salary line for someone who started mid-month", () => {
        // Their contract began on the 20th, and their starting salary with it.
        const rates = ratesForMonth([
            change("2026-11-19T22:00:00Z", 0, "Starting salary", "2026-11-20T08:00:00Z"),
            change("2026-10-31T22:00:00Z", 7_500, "Raise", "2026-11-21T08:00:00Z"),
        ], 2026, 11, CAIRO)
        const segments = splitMonth(2026, 11, rates, { fromDay: 20, toDay: 30 })
        expect(segments.map(s => [s.fromDay, s.toDay, s.monthlyMinor])).toEqual([[20, 30, toMinor(7_500)]])
    })

    it("is the month after's opening rate too", () => {
        expect(ratesForMonth(startedAtZero, 2026, 12, CAIRO)).toEqual([{ fromDay: 1, monthlyMinor: toMinor(9_000), reason: "Raise" }])
    })

    it("is the rate on each of the month's days", () => {
        for (const day of ["2026-11-05T10:00:00Z", "2026-11-23T10:00:00Z", "2026-12-15T10:00:00Z"]) {
            expect(rateAt(startedAtZero, new Date(day))?.monthlyAmount).toBe("9000")
        }
    })

    it("replaces a salary set before it for next month", () => {
        // Next month's set first, then this month's: the page shows this
        // month's, the one set last, and December pays it too.
        const history = [
            change("2026-01-01T00:00:00Z", 8_000, "Starting salary", "2026-01-01T00:00:00Z"),
            change("2026-11-30T22:00:00Z", 9_500, "Next month", "2026-11-10T09:00:00Z"),
            change("2026-10-31T22:00:00Z", 8_800, "This month", "2026-11-20T09:00:00Z"),
        ]
        expect(ratesForMonth(history, 2026, 11, CAIRO).map(r => r.monthlyMinor)).toEqual([toMinor(8_800)])
        expect(ratesForMonth(history, 2026, 12, CAIRO).map(r => r.monthlyMinor)).toEqual([toMinor(8_800)])
        expect(rateAt(history, new Date("2026-12-10T10:00:00Z"))?.monthlyAmount).toBe("8800")
    })

    it("leaves a salary set after it for later in place", () => {
        // This month's set first, then next month's: each month its own.
        const history = [
            change("2026-01-01T00:00:00Z", 8_000, "Starting salary", "2026-01-01T00:00:00Z"),
            change("2026-10-31T22:00:00Z", 8_800, "This month", "2026-11-10T09:00:00Z"),
            change("2026-11-30T22:00:00Z", 9_500, "Next month", "2026-11-20T09:00:00Z"),
        ]
        expect(ratesForMonth(history, 2026, 11, CAIRO).map(r => r.monthlyMinor)).toEqual([toMinor(8_800)])
        expect(ratesForMonth(history, 2026, 12, CAIRO).map(r => r.monthlyMinor)).toEqual([toMinor(9_500)])
    })

    it("keeps this month's starting salary where the salary set after it is next month's", () => {
        // Their 0 from the 22nd stays November's: the salary set after it is December's.
        const history = [
            change("2026-11-21T22:00:00Z", 0, "Starting salary", "2026-11-22T09:00:00Z"),
            change("2026-11-30T22:00:00Z", 9_000, "Next month", "2026-11-25T10:00:00Z"),
        ]
        expect(ratesForMonth(history, 2026, 11, CAIRO)).toEqual([{ fromDay: 22, monthlyMinor: 0, reason: "Starting salary" }])
        expect(ratesForMonth(history, 2026, 12, CAIRO).map(r => r.monthlyMinor)).toEqual([toMinor(9_000)])
    })

    it("leaves earlier months as they were", () => {
        // A salary set for November doesn't reach back into October's.
        const history = [
            change("2026-01-01T00:00:00Z", 8_000, "Starting salary", "2026-01-01T00:00:00Z"),
            change("2026-09-30T21:00:00Z", 8_400, "October", "2026-09-20T09:00:00Z"),
            change("2026-10-31T22:00:00Z", 9_000, "November", "2026-11-25T10:00:00Z"),
        ]
        expect(ratesForMonth(history, 2026, 10, CAIRO).map(r => r.monthlyMinor)).toEqual([toMinor(8_400)])
        expect(rateAt(history, new Date("2026-10-15T10:00:00Z"))?.monthlyAmount).toBe("8400")
    })
})

describe("the two stores of a salary move together", () => {
    const service = stripComments(readFileSync("lib/services/salary-history.service.ts", "utf8"))

    it("writes both in one transaction", () => {
        // User.salary is what every screen reads; SalaryChange is what happened.
        // A payslip computed from history that disagrees with the number an
        // admin is looking at is a dispute nobody can settle, because both
        // sides are reading a true value from a different place.
        expect(service).toContain("prisma.$transaction")
        expect(service).toContain("client.salaryChange.create")
        expect(service).toContain("client.user.update")
    })

    it("does not move the current rate for a future-dated change", () => {
        // A raise effective next month is a fact about October recorded in
        // September. Moving User.salary now would show the new rate on every
        // screen a month early, and pay it a month early too.
        expect(service).toContain("input.effectiveFrom.getTime() <= Date.now()")
    })
})

describe("the generic user update no longer writes a salary on its own", () => {
    const service = stripComments(readFileSync("lib/services/user.service.ts", "utf8"))

    it("routes a salary change through the one writer", () => {
        expect(service).toContain("SalaryHistoryService.record")
        expect(service).toContain("effectiveFromChoice")
    })

    it("only records when the value actually moved", () => {
        // The old sync ran on every update that mentioned salary, so saving a
        // user's name with the salary field untouched still wrote one — which
        // would now mean a SalaryChange row saying the salary changed to what
        // it already was, in a history whose whole purpose is to be read back.
        expect(service).toContain("const salaryMoved")
        expect(service).toContain("!== previousSalary")
    })
})
