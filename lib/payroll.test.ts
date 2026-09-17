import { describe, it, expect } from "vitest"
import {
    toMinor, toMajor, formatMinor, daysInMonth, valueDaysIn, valueDayQuantity,
    valueSegment, segmentDays, splitMonth, totalPayslip,
    type PayslipLine,
} from "./payroll"

/**
 * The worked examples from the design, kept as tests so they cannot quietly
 * stop being true.
 *
 * Every figure here is invented. Production data is test data and was never a
 * reference for any of this; these numbers were chosen to make a rule visible —
 * a salary of 10,000.00 over a 30-day month gives a day rate that does not
 * divide evenly, which is exactly where the interesting failures live.
 */

const SALARY_10K = toMinor(10_000)

describe("money is integer minor units", () => {
    it("converts without float drift", () => {
        expect(toMinor(10_000)).toBe(1_000_000)
        expect(toMinor("1234.56")).toBe(123_456)
        // 0.1 + 0.2 !== 0.3 is the reason this type exists at all.
        expect(toMinor(0.1) + toMinor(0.2)).toBe(toMinor(0.3))
    })

    it("rounds a deduction and an earning of the same size alike", () => {
        // Math.round(-0.5) is -0, so a naive round would give these different
        // magnitudes — a difference nobody could explain on a payslip. 0.125 is
        // used because it is exactly representable in binary, so it genuinely
        // lands on a half and the symmetry is what is being tested.
        expect(toMinor(0.125)).toBe(13)
        expect(toMinor(-0.125)).toBe(-13)
    })

    it("cannot be rescued from a float that was already wrong", () => {
        // I first asserted toMinor(1.005) === 101 and it returned 100. The code
        // was right: 1.005 has no exact binary representation, so 1.005 * 100 is
        // 100.49999999999999 and rounds down. No rounding mode fixes that,
        // because the value was already below the half before rounding began.
        //
        // Which is the argument for this module existing. Money that arrives as
        // a float has already lost this; money that is carried as minor units
        // from the edge inward never does.
        expect(1.005 * 100).toBe(100.49999999999999)
        expect(toMinor(1.005)).toBe(100)
        expect(toMinor("1.005")).toBe(100)
    })

    it("round-trips to a Decimal column and to a printed line", () => {
        expect(toMajor(366_667)).toBe(3_666.67)
        expect(formatMinor(366_667)).toBe("3666.67")
        expect(formatMinor(0)).toBe("0.00")
    })
})

describe("a month is as long as it actually is", () => {
    it("knows the ordinary lengths", () => {
        expect(daysInMonth(2026, 1)).toBe(31)
        expect(daysInMonth(2026, 9)).toBe(30)
        expect(daysInMonth(2026, 2)).toBe(28)
    })

    it("knows a leap February", () => {
        expect(daysInMonth(2028, 2)).toBe(29)
    })

    it("takes a 1-12 month, not a 0-11 one", () => {
        expect(daysInMonth(2026, 12)).toBe(31)
        expect(() => daysInMonth(2026, 0)).toThrow()
        expect(() => daysInMonth(2026, 13)).toThrow()
    })
})

describe("days from a month carry that month's rate", () => {
    it("values eleven days of a 30-day month", () => {
        // 10,000.00 / 30 = 333.333…, × 11 = 3,666.666… → 3,666.67.
        expect(valueDaysIn(2026, 9, 11, SALARY_10K)).toBe(toMinor(3_666.67))
    })

    it("values the same eleven days differently in a 31-day month", () => {
        // The rule, stated as plainly as it can be: the same days, the same
        // salary, a different month, a different answer. 10,000 / 31 × 11 =
        // 3,548.387… → 3,548.39.
        expect(valueDaysIn(2026, 10, 11, SALARY_10K)).toBe(toMinor(3_548.39))
    })

    it("values a whole month as the whole salary, exactly", () => {
        // No rounding drift may survive a full month: a person on a fixed
        // salary who worked every day is paid their salary, in every month.
        for (const month of [1, 2, 4, 9, 12]) {
            expect(valueDaysIn(2026, month, daysInMonth(2026, month), SALARY_10K)).toBe(SALARY_10K)
        }
    })

    it("does not round to a day rate first", () => {
        // A rounded 333.33 × 11 is 3,666.63 — four piastres short, and the gap
        // grows with the number of days. Rounding once, at the end, is what
        // keeps a part-month from drifting away from the salary it came from.
        const naive = toMinor(333.33) * 11
        expect(valueDaysIn(2026, 9, 11, SALARY_10K)).not.toBe(naive)
        expect(valueDaysIn(2026, 9, 11, SALARY_10K) - naive).toBe(4)
    })

    it("pays nothing for no days", () => {
        expect(valueDaysIn(2026, 9, 0, SALARY_10K)).toBe(0)
    })

    it("refuses more days than the month has", () => {
        // 31 days of September is not a rounding question, it is a bug
        // upstream, and silently paying for it would hide the bug.
        expect(() => valueDaysIn(2026, 9, 31, SALARY_10K)).toThrow(/30-day month/)
        expect(() => valueDaysIn(2026, 9, -1, SALARY_10K)).toThrow()
    })
})

describe("segments are inclusive on both ends", () => {
    it("counts the 1st to the 15th as fifteen days", () => {
        // Off-by-one here is a day's pay, every time, for everyone.
        expect(segmentDays({ year: 2026, month: 9, fromDay: 1, toDay: 15, monthlyMinor: SALARY_10K })).toBe(15)
        expect(segmentDays({ year: 2026, month: 9, fromDay: 9, toDay: 9, monthlyMinor: SALARY_10K })).toBe(1)
    })

    it("values a segment at its own month's rate", () => {
        expect(valueSegment({ year: 2026, month: 9, fromDay: 1, toDay: 11, monthlyMinor: SALARY_10K }))
            .toBe(toMinor(3_666.67))
    })

    it("refuses a segment that leaves the month", () => {
        expect(() => valueSegment({ year: 2026, month: 9, fromDay: 1, toDay: 31, monthlyMinor: SALARY_10K })).toThrow()
        expect(() => valueSegment({ year: 2026, month: 9, fromDay: 0, toDay: 5, monthlyMinor: SALARY_10K })).toThrow()
        expect(() => valueSegment({ year: 2026, month: 9, fromDay: 10, toDay: 5, monthlyMinor: SALARY_10K })).toThrow()
    })
})

describe("a month splits at each salary change", () => {
    const OLD = toMinor(10_000)
    const NEW = toMinor(12_000)

    it("covers the month exactly once with no change", () => {
        const segments = splitMonth(2026, 9, [{ fromDay: 1, monthlyMinor: OLD }])
        expect(segments).toHaveLength(1)
        expect(segments[0]).toMatchObject({ fromDay: 1, toDay: 30 })
        expect(valueSegment(segments[0])).toBe(OLD)
    })

    it("splits on the day the new salary starts", () => {
        // A raise from the 16th: the 1st-15th at the old rate, 16th-30th at the
        // new one. The boundary belongs to the new rate, because "effective
        // from the 16th" means the 16th is paid at it.
        const segments = splitMonth(2026, 9, [
            { fromDay: 1, monthlyMinor: OLD },
            { fromDay: 16, monthlyMinor: NEW },
        ])
        expect(segments.map(s => [s.fromDay, s.toDay])).toEqual([[1, 15], [16, 30]])
        expect(segments[0].monthlyMinor).toBe(OLD)
        expect(segments[1].monthlyMinor).toBe(NEW)
    })

    it("leaves no gap and no overlap", () => {
        // Both are silent: an overlap pays twice and a gap pays nothing, and
        // the only symptom is a total that is wrong with no line to point at.
        const segments = splitMonth(2026, 9, [
            { fromDay: 1, monthlyMinor: OLD },
            { fromDay: 8, monthlyMinor: NEW },
            { fromDay: 20, monthlyMinor: OLD },
        ])
        expect(segments[0].fromDay).toBe(1)
        expect(segments[segments.length - 1].toDay).toBe(30)
        for (let i = 1; i < segments.length; i++) {
            expect(segments[i].fromDay).toBe(segments[i - 1].toDay + 1)
        }
        expect(segments.reduce((sum, s) => sum + segmentDays(s), 0)).toBe(30)
    })

    it("carries a rate set before the window began", () => {
        // A mid-month joiner whose salary was set last month has no change
        // inside the window at all; without this they would have no rate.
        const segments = splitMonth(2026, 9, [{ fromDay: 1, monthlyMinor: OLD }], { fromDay: 12, toDay: 30 })
        expect(segments).toHaveLength(1)
        expect(segments[0]).toMatchObject({ fromDay: 12, toDay: 30, monthlyMinor: OLD })
    })

    it("values a leaver's part-month from the segments", () => {
        // Last working day the 11th, on 10,000.00, in a 30-day month.
        const segments = splitMonth(2026, 9, [{ fromDay: 1, monthlyMinor: SALARY_10K }], { toDay: 11 })
        const total = segments.reduce((sum, s) => sum + valueSegment(s), 0)
        expect(total).toBe(toMinor(3_666.67))
    })

    it("ignores changes outside the window", () => {
        const segments = splitMonth(2026, 9, [
            { fromDay: 1, monthlyMinor: OLD },
            { fromDay: 25, monthlyMinor: NEW },
        ], { toDay: 11 })
        expect(segments).toHaveLength(1)
        expect(segments[0].monthlyMinor).toBe(OLD)
    })

    it("refuses a window with no salary in effect", () => {
        expect(() => splitMonth(2026, 9, [])).toThrow(/No salary/)
        expect(() => splitMonth(2026, 9, [{ fromDay: 10, monthlyMinor: OLD }], { fromDay: 1 }))
            .toThrow(/No salary in effect on day 1/)
    })
})

describe("a payslip adds up to what it prints", () => {
    const line = (kind: PayslipLine["kind"], label: string, major: number): PayslipLine =>
        ({ kind, label, amountMinor: toMinor(major) })

    it("sums the lines rather than re-deriving the total", () => {
        // The printed column must equal the printed total. Re-deriving from the
        // underlying rates produces a document where it does not, and nothing
        // makes that read as anything but an error.
        const totals = totalPayslip([
            line("EARNING", "Basic", 3_666.67),
            line("EARNING", "Bonus", 500),
            line("DEDUCTION", "Penalty", 166.67),
        ])
        expect(totals.earningsMinor).toBe(toMinor(4_166.67))
        expect(totals.deductionsMinor).toBe(toMinor(166.67))
        expect(totals.netMinor).toBe(toMinor(4_000))
        expect(totals.carriedMinor).toBe(0)
    })

    it("floors the net at zero and carries the rest as a debt", () => {
        // Negative pay is not a thing that happens: the employer does not take
        // money out of a bank account. The excess becomes a debt with its own
        // status and due date.
        const totals = totalPayslip([
            line("EARNING", "Basic", 1_000),
            line("DEDUCTION", "Overpaid days", 1_250),
        ])
        expect(totals.netMinor).toBe(0)
        expect(totals.carriedMinor).toBe(toMinor(250))
    })

    it("carries nothing when the deductions exactly consume the pay", () => {
        const totals = totalPayslip([
            line("EARNING", "Basic", 1_000),
            line("DEDUCTION", "Overpaid days", 1_000),
        ])
        expect(totals.netMinor).toBe(0)
        expect(totals.carriedMinor).toBe(0)
    })

    it("handles an empty payslip", () => {
        // A suspended employee with nothing owed either way still gets a
        // document, and it must not be an exception.
        expect(totalPayslip([])).toEqual({
            earningsMinor: 0, deductionsMinor: 0, netMinor: 0, carriedMinor: 0,
        })
    })

    it("refuses a negative line", () => {
        // A negative earning is a deduction wearing the wrong label, and it
        // would quietly break the floor: "earnings" on the document has to mean
        // what it says.
        expect(() => totalPayslip([{ kind: "EARNING", label: "Odd", amountMinor: -100 }]))
            .toThrow(/negative/)
    })

    it("refuses a line that is not whole minor units", () => {
        // A fractional piastre means a rounding was skipped upstream, and the
        // printed lines would stop summing to the printed total.
        expect(() => totalPayslip([{ kind: "EARNING", label: "Odd", amountMinor: 100.5 }]))
            .toThrow(/whole minor units/)
    })
})

describe("the worked example, end to end", () => {
    it("pays a leaver for the days they worked, at their own month's rate", () => {
        // Salary 10,000.00, last working day 11 September, a 30-day month, and
        // a pending 3,666.67 owed from an earlier suspension.
        const worked = splitMonth(2026, 9, [{ fromDay: 1, monthlyMinor: SALARY_10K }], { toDay: 11 })
            .reduce((sum, s) => sum + valueSegment(s), 0)

        const totals = totalPayslip([
            { kind: "EARNING", label: "1–11 September", amountMinor: worked },
            { kind: "EARNING", label: "Pending · Aug suspension", amountMinor: toMinor(3_666.67) },
        ])

        expect(formatMinor(worked)).toBe("3666.67")
        expect(formatMinor(totals.netMinor)).toBe("7333.34")
        expect(totals.carriedMinor).toBe(0)
    })

    it("turns an overpaid tail window into a debt, not a negative payslip", () => {
        // Paid on the 25th for all thirty days, left on the 27th: three days
        // paid and not worked, at September's rate.
        const owed = valueDaysIn(2026, 9, 3, SALARY_10K)
        expect(formatMinor(owed)).toBe("1000.00")

        const totals = totalPayslip([
            { kind: "DEDUCTION", label: "28–30 September, paid 25 Sep", amountMinor: owed },
        ])
        expect(totals.netMinor).toBe(0)
        expect(formatMinor(totals.carriedMinor)).toBe("1000.00")
    })
})

describe("a window of the month and a quantity of days are different things", () => {
    it("refuses a window longer than its month", () => {
        // A segment that spans more days than the month has is a bug in
        // whatever produced it, and the throw is what catches it.
        expect(() => valueDaysIn(2026, 9, 31, toMinor(30_000))).toThrow(/31 days in a 30-day month/)
    })

    it("allows a quantity longer than its month", () => {
        // Forty days' pay deducted to repay an advance is an ordinary entry
        // against a thirty-day month. These were one function until a register
        // tried to value exactly this and threw — which would have taken down a
        // whole company's payroll rather than produced one large line.
        expect(formatMinor(valueDayQuantity(2026, 9, 40, toMinor(30_000)))).toBe("40000.00")
    })

    it("agree wherever both are legal", () => {
        for (const days of [0, 1, 15, 30]) {
            expect(valueDaysIn(2026, 9, days, toMinor(30_000)))
                .toBe(valueDayQuantity(2026, 9, days, toMinor(30_000)))
        }
    })

    it("both refuse a negative", () => {
        expect(() => valueDaysIn(2026, 9, -1, toMinor(30_000))).toThrow(/Negative days/)
        expect(() => valueDayQuantity(2026, 9, -1, toMinor(30_000))).toThrow(/Negative days/)
    })
})
