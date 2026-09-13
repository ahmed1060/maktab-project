import { describe, it, expect } from "vitest"
import { nextOccurrence, RECURRENCE_STYLE } from "./recurrence"

const d = (s: string) => new Date(s + "T09:00:00.000Z")
const iso = (x: Date | null) => (x === null ? null : x.toISOString().slice(0, 10))

describe("MONTHLY clamps instead of skipping the short month", () => {
    it("31 January goes to 28 February, not 3 March", () => {
        // The defect: setMonth overflowed, so a monthly obligation due on the
        // 31st never produced a February instance at all.
        expect(iso(nextOccurrence(d("2026-01-31"), "MONTHLY"))).toBe("2026-02-28")
    })

    it("31 January goes to 29 February in a leap year", () => {
        expect(iso(nextOccurrence(d("2028-01-31"), "MONTHLY"))).toBe("2028-02-29")
    })

    it("31 March goes to 30 April", () => {
        expect(iso(nextOccurrence(d("2026-03-31"), "MONTHLY"))).toBe("2026-04-30")
    })

    it("an ordinary day-of-month is untouched", () => {
        expect(iso(nextOccurrence(d("2026-09-18"), "MONTHLY"))).toBe("2026-10-18")
        expect(iso(nextOccurrence(d("2026-12-15"), "MONTHLY"))).toBe("2027-01-15")
    })

    it("a series does not climb back after clamping — the documented caveat", () => {
        // Each instance is computed from the previous one and nothing records
        // the day the series started, so 31 January settles on the 28th. Still
        // strictly better than skipping February and drifting to the 3rd.
        let cursor: Date | null = d("2026-01-31")
        const chain: (string | null)[] = []
        for (let i = 0; i < 4; i++) {
            cursor = nextOccurrence(cursor!, "MONTHLY")
            chain.push(iso(cursor))
        }
        expect(chain).toEqual(["2026-02-28", "2026-03-28", "2026-04-28", "2026-05-28"])
    })

    it("no month is ever skipped, whatever the starting day", () => {
        for (let day = 1; day <= 31; day++) {
            const start = new Date(Date.UTC(2026, 0, day, 9))
            const next = nextOccurrence(start, "MONTHLY")!
            expect(next.getMonth()).toBe(1) // February, never March
        }
    })
})

describe("YEARLY clamps the leap day", () => {
    it("29 February goes to 28 February, not 1 March", () => {
        expect(iso(nextOccurrence(d("2028-02-29"), "YEARLY"))).toBe("2029-02-28")
    })

    it("an ordinary date is unremarkable", () => {
        expect(iso(nextOccurrence(d("2026-10-03"), "YEARLY"))).toBe("2027-10-03")
    })
})

describe("DAILY and WEEKLY need no clamping", () => {
    it("crosses a month boundary", () => {
        expect(iso(nextOccurrence(d("2026-09-30"), "DAILY"))).toBe("2026-10-01")
        expect(iso(nextOccurrence(d("2026-01-31"), "DAILY"))).toBe("2026-02-01")
    })

    it("crosses a year boundary", () => {
        expect(iso(nextOccurrence(d("2026-12-31"), "DAILY"))).toBe("2027-01-01")
        expect(iso(nextOccurrence(d("2026-12-28"), "WEEKLY"))).toBe("2027-01-04")
    })

    it("adds exactly seven days", () => {
        expect(iso(nextOccurrence(d("2026-09-11"), "WEEKLY"))).toBe("2026-09-18")
    })

    it("steps onto the leap day rather than over it", () => {
        expect(iso(nextOccurrence(d("2028-02-28"), "DAILY"))).toBe("2028-02-29")
    })
})

describe("recurrences with no next instance", () => {
    it("ONE_TIME yields null, not its own deadline repeated", () => {
        expect(nextOccurrence(d("2026-09-18"), "ONE_TIME")).toBeNull()
    })

    it("an unrecognised value yields null rather than silently repeating", () => {
        // Defensive rather than a live fix: recurrence is a database enum, so
        // today only the five known values exist. But the old switch fell
        // through and left the deadline unchanged, so the day someone adds a
        // sixth member without touching it, every such obligation would have
        // been handed its own deadline back and read as a due instance.
        expect(nextOccurrence(d("2026-09-18"), "FORTNIGHTLY")).toBeNull()
        expect(nextOccurrence(d("2026-09-18"), "")).toBeNull()
    })
})

describe("shared invariants", () => {
    it("never mutates its input", () => {
        const start = d("2026-01-31")
        nextOccurrence(start, "MONTHLY")
        expect(iso(start)).toBe("2026-01-31")
    })

    it("preserves the time of day, so a deadline does not creep earlier", () => {
        const start = new Date("2026-01-31T15:00:00.000Z")
        expect(nextOccurrence(start, "MONTHLY")!.toISOString()).toBe("2026-02-28T15:00:00.000Z")
    })

    it("every styled recurrence except ONE_TIME has a next instance", () => {
        for (const key of Object.keys(RECURRENCE_STYLE)) {
            const next = nextOccurrence(d("2026-09-15"), key)
            if (key === "ONE_TIME") expect(next).toBeNull()
            else expect(next).not.toBeNull()
        }
    })

    it("the next instance is always strictly later", () => {
        const start = d("2026-01-31")
        for (const key of ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) {
            expect(nextOccurrence(start, key)!.getTime()).toBeGreaterThan(start.getTime())
        }
    })
})
