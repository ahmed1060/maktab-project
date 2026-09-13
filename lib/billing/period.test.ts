import { describe, it, expect } from "vitest"
import { addMonths, addYears, computePeriodEnd, computePeriodStart, isExpired, daysUntil } from "./period"

const d = (s: string) => new Date(s + "T12:00:00.000Z")
const iso = (x: Date | null) => (x === null ? null : x.toISOString().slice(0, 10))

describe("addMonths clamps instead of overflowing", () => {
    it("31 January + 1 month is 28 February, not 3 March", () => {
        expect(iso(addMonths(d("2026-01-31"), 1))).toBe("2026-02-28")
    })

    it("31 January + 1 month is 29 February in a leap year", () => {
        expect(iso(addMonths(d("2028-01-31"), 1))).toBe("2028-02-29")
    })

    it("30 November + 3 months is 28 February", () => {
        expect(iso(addMonths(d("2026-11-30"), 3))).toBe("2027-02-28")
    })

    it("31 March + 1 month is 30 April", () => {
        expect(iso(addMonths(d("2026-03-31"), 1))).toBe("2026-04-30")
    })

    it("does not clamp when the target month is long enough", () => {
        expect(iso(addMonths(d("2026-01-15"), 1))).toBe("2026-02-15")
        expect(iso(addMonths(d("2026-01-31"), 2))).toBe("2026-03-31")
    })

    it("crosses the year boundary", () => {
        expect(iso(addMonths(d("2026-12-31"), 1))).toBe("2027-01-31")
        expect(iso(addMonths(d("2026-10-08"), 3))).toBe("2027-01-08")
    })

    it("leaves the input untouched", () => {
        const start = d("2026-01-31")
        addMonths(start, 1)
        expect(iso(start)).toBe("2026-01-31")
    })

    it("preserves the time of day, so an end date does not drift earlier each period", () => {
        const start = new Date("2026-01-15T09:30:00.000Z")
        expect(addMonths(start, 1).toISOString()).toBe("2026-02-15T09:30:00.000Z")
    })
})

describe("addYears", () => {
    it("29 February + 1 year is 28 February", () => {
        expect(iso(addYears(d("2028-02-29"), 1))).toBe("2029-02-28")
    })

    it("29 February + 4 years is 29 February again", () => {
        expect(iso(addYears(d("2028-02-29"), 4))).toBe("2032-02-29")
    })

    it("an ordinary date is unremarkable", () => {
        expect(iso(addYears(d("2026-09-13"), 1))).toBe("2027-09-13")
    })
})

describe("computePeriodEnd", () => {
    it("a month is a calendar month, not 30 days", () => {
        // The defect this replaces: twelve 30-day 'months' bought 360 days,
        // five short of the year an annual payment bought.
        expect(iso(computePeriodEnd(d("2026-01-01"), "MONTHLY"))).toBe("2026-02-01")
        expect(iso(computePeriodEnd(d("2026-03-01"), "MONTHLY"))).toBe("2026-04-01")
    })

    it("twelve monthly periods land exactly one year out", () => {
        let cursor = d("2026-01-15")
        for (let i = 0; i < 12; i++) cursor = computePeriodEnd(cursor, "MONTHLY")!
        expect(iso(cursor)).toBe("2027-01-15")
        expect(iso(cursor)).toBe(iso(computePeriodEnd(d("2026-01-15"), "ANNUALLY")))
    })

    it("annually is a calendar year", () => {
        expect(iso(computePeriodEnd(d("2026-09-13"), "ANNUALLY"))).toBe("2027-09-13")
    })

    it("lifetime has no end date at all", () => {
        expect(computePeriodEnd(d("2026-09-13"), "LIFETIME")).toBeNull()
    })
})

describe("computePeriodStart — renewal dating", () => {
    const now = d("2026-09-13")

    it("paying early starts at the current period's end, not today", () => {
        // Otherwise renewing a week early silently discards that week.
        expect(iso(computePeriodStart(now, d("2026-10-08")))).toBe("2026-10-08")
    })

    it("paying after expiry starts today, not back-dated", () => {
        expect(iso(computePeriodStart(now, d("2026-08-01")))).toBe("2026-09-13")
    })

    it("a first payment starts today", () => {
        expect(iso(computePeriodStart(now, null))).toBe("2026-09-13")
        expect(iso(computePeriodStart(now, undefined))).toBe("2026-09-13")
    })

    it("an end date exactly now starts now", () => {
        expect(iso(computePeriodStart(now, now))).toBe("2026-09-13")
    })

    it("returns a copy, so mutating the result cannot move the stored end date", () => {
        const currentEnd = d("2026-10-08")
        const start = computePeriodStart(now, currentEnd)
        start.setFullYear(1999)
        expect(iso(currentEnd)).toBe("2026-10-08")
    })

    it("renewing early then adding a month extends rather than overlaps", () => {
        const start = computePeriodStart(now, d("2026-10-08"))
        expect(iso(computePeriodEnd(start, "MONTHLY"))).toBe("2026-11-08")
    })
})

describe("isExpired — the null landmine", () => {
    const now = d("2026-09-13")

    it("a lifetime subscription never expires", () => {
        // `endDate < new Date()` coerces null to the epoch and reports 1970,
        // which would lock out exactly the customers who paid the most.
        expect(isExpired(null, now)).toBe(false)
        expect(isExpired(undefined, now)).toBe(false)
        expect((null as any) < now).toBe(true) // the coercion, for the record
    })

    it("a past end date is expired", () => {
        expect(isExpired(d("2026-09-12"), now)).toBe(true)
    })

    it("a future end date is not", () => {
        expect(isExpired(d("2026-09-14"), now)).toBe(false)
    })

    it("the exact instant of expiry counts as expired", () => {
        expect(isExpired(now, now)).toBe(true)
    })
})

describe("daysUntil", () => {
    const now = d("2026-09-13")

    it("lifetime has no countdown", () => {
        expect(daysUntil(null, now)).toBeNull()
    })

    it("rounds up, so a part-day still reads as a day remaining", () => {
        expect(daysUntil(new Date("2026-09-14T00:00:00.000Z"), now)).toBe(1)
        expect(daysUntil(new Date("2026-09-14T23:00:00.000Z"), now)).toBe(2)
    })

    it("counts the 2026-10-08 subscription as entering the 14-day window on 2026-09-24", () => {
        expect(daysUntil(d("2026-10-08"), d("2026-09-24"))).toBe(14)
        expect(daysUntil(d("2026-10-08"), d("2026-09-25"))).toBe(13)
    })
})
