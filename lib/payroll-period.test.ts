import { describe, it, expect } from "vitest"
import {
    closeDateOf, periodBetween, payrollMonthOf, nominalPayday, movePayday, paydayAfterClose, dayOffOn, paidAlready,
    paydayRefusal, type PaydaySetting,
} from "./payroll-period"

/**
 * Payday and the attendance period (LATER_CHANGES_PLAN.md §7.10, PR 430):
 * when a month's payroll closes, which days its attendance counts, which
 * payroll month a date belongs to, and the day it's paid, moved off a day
 * off. Pure, so the rules are tested on worked examples.
 */

const day = (d: number, over: Partial<PaydaySetting> = {}): PaydaySetting => ({ day: d, lastDay: false, nextMonth: false, move: "BEFORE", ...over })
// Friday and Saturday off, as with no policy.
const weekend = (date: string) => dayOffOn(date, { weeks: [], holidays: new Set() })

describe("when a month's payroll closes", () => {
    it("is its last day, or the day set", () => {
        expect(closeDateOf(2026, 11, null)).toBe("2026-11-30")
        expect(closeDateOf(2026, 2, null)).toBe("2026-02-28")
        expect(closeDateOf(2028, 2, null)).toBe("2028-02-29")
        expect(closeDateOf(2026, 11, 24)).toBe("2026-11-24")
        expect(closeDateOf(2026, 12, 1)).toBe("2026-12-01")
    })
})

describe("the attendance period", () => {
    it("runs from the day after the month before's close to its own", () => {
        expect(periodBetween("2026-10-24", "2026-11-24")).toEqual({ from: "2026-10-25", to: "2026-11-24" })
        expect(periodBetween("2026-11-30", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" })
    })

    it("is shorter or longer once, when the close changes, with no gap and no overlap", () => {
        // November closed on its last day; from December, on the 24th.
        expect(periodBetween("2026-11-30", "2026-12-24")).toEqual({ from: "2026-12-01", to: "2026-12-24" })
        // November closed on the 24th; from December, on the month's last day.
        expect(periodBetween("2026-11-24", "2026-12-31")).toEqual({ from: "2026-11-25", to: "2026-12-31" })
    })
})

describe("which payroll month a date belongs to", () => {
    const closingOn24 = (year: number, month: number) => closeDateOf(year, month, 24)
    it("is its own month's up to that month's close, and the next month's after it", () => {
        expect(payrollMonthOf("2026-11-24", closingOn24)).toBe("2026-11")
        expect(payrollMonthOf("2026-11-25", closingOn24)).toBe("2026-12")
        expect(payrollMonthOf("2026-12-31", closingOn24)).toBe("2027-01")
        expect(payrollMonthOf("2026-11-30", (y, m) => closeDateOf(y, m, null))).toBe("2026-11")
    })
})

describe("payday", () => {
    it("is the day set, or the month's last, in the payroll's own month or the next", () => {
        expect(nominalPayday(2026, 11, day(28))).toBe("2026-11-28")
        expect(nominalPayday(2026, 2, day(1, { lastDay: true }))).toBe("2026-02-28")
        expect(nominalPayday(2026, 12, day(1, { nextMonth: true }))).toBe("2027-01-01")
        expect(nominalPayday(2026, 11, day(1, { lastDay: true, nextMonth: true }))).toBe("2026-12-31")
    })

    it("moves off a weekend day to the working day before, or after", () => {
        // 28 November 2026 is a Saturday.
        expect(movePayday("2026-11-28", "BEFORE", weekend, "2026-11-24")).toBe("2026-11-26")
        expect(movePayday("2026-11-28", "AFTER", weekend, "2026-11-24")).toBe("2026-11-29")
        // A working day stays where it is.
        expect(movePayday("2026-11-26", "BEFORE", weekend, "2026-11-24")).toBe("2026-11-26")
    })

    it("moves off a holiday too", () => {
        const offs = (date: string) => dayOffOn(date, { weeks: [], holidays: new Set(["2026-11-26"]) })
        expect(movePayday("2026-11-28", "BEFORE", offs, "2026-11-24")).toBe("2026-11-25")
    })

    it("never moves back into the period: it moves forward instead", () => {
        // 1 January 2027 is a Friday; the day before is December's last, inside its period.
        expect(movePayday("2027-01-01", "BEFORE", weekend, "2026-12-31")).toBe("2027-01-03")
        // The 25th a Friday, payroll closing on the 24th.
        expect(movePayday("2026-12-25", "BEFORE", weekend, "2026-12-24")).toBe("2026-12-27")
    })

    it("follows the work week of the policy in force on the day", () => {
        // From December, a policy with Saturday as a workday.
        const weeks = [{ effectiveFrom: "2026-12-01", workWeek: [6, 0, 1, 2, 3, 4] }]
        expect(dayOffOn("2026-11-28", { weeks, holidays: new Set() })).toBe(true)
        expect(dayOffOn("2026-12-05", { weeks, holidays: new Set() })).toBe(false)
        expect(dayOffOn("2026-12-04", { weeks, holidays: new Set() })).toBe(true)
    })
})

describe("payday comes after the close", () => {
    it("always, in the month after", () => {
        expect(paydayAfterClose(day(1, { nextMonth: true }), null)).toBe(true)
        expect(paydayAfterClose(day(28, { nextMonth: true }), 28)).toBe(true)
    })

    it("in the payroll's own month, only on a day after the close", () => {
        expect(paydayAfterClose(day(25), 24)).toBe(true)
        expect(paydayAfterClose(day(24), 24)).toBe(false)
        expect(paydayAfterClose(day(28), null)).toBe(false)
    })

    it("on the month's last day, only with a close up to the 27th, February's 28th being the shortest", () => {
        expect(paydayAfterClose(day(1, { lastDay: true }), 27)).toBe(true)
        expect(paydayAfterClose(day(1, { lastDay: true }), 28)).toBe(false)
        expect(paydayAfterClose(day(1, { lastDay: true }), null)).toBe(false)
    })

    it("says why and what to pick when it doesn't", () => {
        expect(paydayRefusal(day(20), 24)).toEqual({ code: "PAYDAY_BEFORE_CLOSE", closeDay: 24 })
        expect(paydayRefusal(day(25), null)).toEqual({ code: "PAYDAY_BEFORE_CLOSE", closeDay: null })
        expect(paydayRefusal(day(25), 24)).toBeNull()
    })
})

describe("a leaver's last month, already paid or not", () => {
    it("is paid from payday on, payday itself included", () => {
        expect(paidAlready("2026-11-26", "2026-11-26")).toBe(true)
        expect(paidAlready("2026-11-25", "2026-11-26")).toBe(false)
        // Paid in the month after: never by the time the month's last day is worked.
        expect(paidAlready("2026-11-30", "2026-12-01")).toBe(false)
    })
})
