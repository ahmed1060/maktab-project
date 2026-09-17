import { describe, it, expect } from "vitest"
import {
    isValidPayrollDay, assertValidPayrollDay, MAX_PAYROLL_DAY,
    paydayIn, paydayHasPassed, nextPaydayOnOrAfter, daysAlreadyPaid,
} from "./payday"
import { calendarDateStr, offsetMsIn } from "./time"

const CAIRO = "Africa/Cairo"

const local = (year: number, month: number, day: number, hour = 12): Date => {
    const guess = Date.UTC(year, month - 1, day, hour)
    return new Date(guess - offsetMsIn(new Date(guess), CAIRO))
}

describe("a payroll day has to occur in every month", () => {
    it("accepts 1 to 28", () => {
        expect(isValidPayrollDay(1)).toBe(true)
        expect(isValidPayrollDay(MAX_PAYROLL_DAY)).toBe(true)
        expect(MAX_PAYROLL_DAY).toBe(28)
    })

    it("refuses a day February does not have", () => {
        // "The 30th" meaning the 28th in one month out of twelve is a rule
        // nobody remembers when they are trying to work out why a leaver was
        // billed rather than paid.
        for (const day of [29, 30, 31, 0, -1, 1.5, NaN]) {
            expect(isValidPayrollDay(day), String(day)).toBe(false)
        }
        expect(() => assertValidPayrollDay(31)).toThrow(/1 and 28/)
    })
})

describe("payday is a day in the company's own calendar", () => {
    it("lands on local midnight, not UTC midnight", () => {
        // Cairo is two or three hours ahead, so a UTC midnight would make
        // payday begin on the previous evening for the company.
        const payday = paydayIn(2026, 9, 25, CAIRO)
        expect(calendarDateStr(payday, CAIRO)).toBe("2026-09-25")
        expect(payday.toISOString()).toBe("2026-09-24T21:00:00.000Z")
    })

    it("refuses a month that is not a month", () => {
        expect(() => paydayIn(2026, 13, 25, CAIRO)).toThrow()
        expect(() => paydayIn(2026, 9, 31, CAIRO)).toThrow()
    })
})

describe("whether payday has been and gone", () => {
    it("has not, before it", () => {
        expect(paydayHasPassed(local(2026, 9, 24), 25, CAIRO)).toBe(false)
    })

    it("has, on the day itself", () => {
        // Inclusive on purpose. Rounding the other way would tell somebody
        // leaving on payday that they are owed a month they have been paid.
        expect(paydayHasPassed(local(2026, 9, 25, 0), 25, CAIRO)).toBe(true)
        expect(paydayHasPassed(local(2026, 9, 25, 23), 25, CAIRO)).toBe(true)
    })

    it("has, after it", () => {
        expect(paydayHasPassed(local(2026, 9, 28), 25, CAIRO)).toBe(true)
    })

    it("is asked of the month the date is in, not of some other month", () => {
        // The 1st of October is before October's payday even though it is after
        // September's.
        expect(paydayHasPassed(local(2026, 10, 1), 25, CAIRO)).toBe(false)
    })
})

describe("the next payday is a settlement's due date", () => {
    it("is this month's when it has not passed", () => {
        expect(calendarDateStr(nextPaydayOnOrAfter(local(2026, 9, 10), 25, CAIRO), CAIRO))
            .toBe("2026-09-25")
    })

    it("is today when today is payday", () => {
        expect(calendarDateStr(nextPaydayOnOrAfter(local(2026, 9, 25), 25, CAIRO), CAIRO))
            .toBe("2026-09-25")
    })

    it("rolls into next month once it has passed", () => {
        expect(calendarDateStr(nextPaydayOnOrAfter(local(2026, 9, 26), 25, CAIRO), CAIRO))
            .toBe("2026-10-25")
    })

    it("rolls into January rather than month thirteen", () => {
        expect(calendarDateStr(nextPaydayOnOrAfter(local(2026, 12, 27), 25, CAIRO), CAIRO))
            .toBe("2027-01-25")
    })
})

describe("the tail window, which is what makes a leaver owe", () => {
    it("is nothing before payday", () => {
        // Leaving on the 20th of a month paid on the 25th: nothing has gone out,
        // so the company owes the days worked.
        expect(daysAlreadyPaid(local(2026, 9, 20), 25, CAIRO)).toBe(0)
    })

    it("is the whole month once payday has passed", () => {
        // The company pays the whole month on payday, including the days after
        // it nobody has worked yet. A leaver inside that window owes them back.
        expect(daysAlreadyPaid(local(2026, 9, 28), 25, CAIRO)).toBe(30)
    })

    it("is the month's own length, not thirty", () => {
        // valueDaysIn's rule again: a day in February is worth more than a day
        // in January, because both are a fraction of the same salary.
        expect(daysAlreadyPaid(local(2026, 1, 28), 25, CAIRO)).toBe(31)
        expect(daysAlreadyPaid(local(2026, 2, 27), 25, CAIRO)).toBe(28)
        expect(daysAlreadyPaid(local(2024, 2, 27), 25, CAIRO)).toBe(29)
    })
})

describe("the sign, end to end", () => {
    // The case the whole phase exists for: same salary, same month, two
    // leaving dates either side of payday, opposite directions.
    const payrollDay = 25

    it("owes the person when they leave before payday", () => {
        expect(daysAlreadyPaid(local(2026, 9, 20), payrollDay, CAIRO)).toBe(0)
    })

    it("owes the company when they leave after it", () => {
        expect(daysAlreadyPaid(local(2026, 9, 28), payrollDay, CAIRO)).toBe(30)
    })
})
