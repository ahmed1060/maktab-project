import { describe, it, expect } from "vitest"
import {
    buildEntry, buildRegister, variance, nextIssueBatch, ISSUE_BATCH_SIZE,
    type PersonMonth,
} from "./register"
import { timelineForMonth, type EmploymentEventRow } from "./employment"
import { toMinor, formatMinor } from "./payroll"
import { offsetMsIn } from "./time"

const CAIRO = "Africa/Cairo"
const local = (y: number, m: number, d: number, h = 0) => {
    const guess = Date.UTC(y, m - 1, d, h)
    return new Date(guess - offsetMsIn(new Date(guess), CAIRO))
}
const HIRED = { type: "HIRED", effectiveFrom: new Date(0) } as EmploymentEventRow
const ev = (type: EmploymentEventRow["type"], at: Date, extra: Partial<EmploymentEventRow> = {}) =>
    ({ type, effectiveFrom: at, ...extra }) as EmploymentEventRow

/** September 2026: 30 days. 30,000 a month is 1,000 a day. */
const person = (over: Partial<PersonMonth> = {}, events: EmploymentEventRow[] = [HIRED]): PersonMonth => ({
    userId: "u1",
    name: "Mona Fahmy",
    timeline: timelineForMonth(events, 2026, 9, CAIRO),
    rates: [{ fromDay: 1, monthlyMinor: toMinor(30_000) }],
    adjustments: [],
    ...over,
})

describe("a payslip explains itself", () => {
    it("is one salary line for a whole month", () => {
        const entry = buildEntry(person())
        expect(entry.lines).toHaveLength(1)
        expect(entry.lines[0]).toMatchObject({ kind: "EARNING", label: "Salary", source: "SALARY" })
        expect(formatMinor(entry.totals.netMinor)).toBe("30000.00")
        expect(entry.daysPaid).toBe(30)
        expect(entry.wholeMonth).toBe(true)
    })

    it("splits into two lines across a mid-month raise, each naming its days", () => {
        // The point of a payslip over a number: a person who got a raise should
        // be able to see the two halves rather than one total they cannot check.
        const entry = buildEntry(person({
            rates: [
                { fromDay: 1, monthlyMinor: toMinor(30_000) },
                { fromDay: 16, monthlyMinor: toMinor(60_000) },
            ],
        }))
        expect(entry.lines.map(l => l.label)).toEqual([
            "Salary, days 1–15",
            "Salary, days 16–30",
        ])
        // 15 days at 1,000 and 15 at 2,000.
        expect(formatMinor(entry.totals.netMinor)).toBe("45000.00")
    })

    it("pays a leaver only for the days they were there", () => {
        const entry = buildEntry(person({}, [HIRED, ev("CONTRACT_ENDED", local(2026, 9, 11))]))
        expect(entry.daysPaid).toBe(10)
        expect(formatMinor(entry.totals.netMinor)).toBe("10000.00")
        expect(entry.wholeMonth).toBe(false)
    })

    it("pays partially through a suspension that was ruled deductible", () => {
        const entry = buildEntry(person({}, [
            HIRED,
            ev("SUSPENDED", local(2026, 9, 5)),
            ev("UNSUSPENDED", local(2026, 9, 8), { deductSuspension: true }),
        ]))
        // 1-4 and 8-30 — 27 days.
        expect(entry.daysPaid).toBe(27)
        expect(entry.lines).toHaveLength(2)
        expect(formatMinor(entry.totals.netMinor)).toBe("27000.00")
    })
})

describe("adjustments are days, valued at this month's rate", () => {
    it("adds a bonus and subtracts a deduction", () => {
        const entry = buildEntry(person({
            adjustments: [
                { type: "BONUS", days: 2, reason: "Covered a colleague", source: "MANUAL" },
                { type: "DEDUCTION", days: 1, reason: "Lateness Penalty Deduction", source: "TASK_PENALTY", sourceId: "t1" },
            ],
        }))
        expect(entry.lines.map(l => [l.kind, l.label, formatMinor(l.amountMinor)])).toEqual([
            ["EARNING", "Salary", "30000.00"],
            ["EARNING", "Covered a colleague", "2000.00"],
            ["DEDUCTION", "Lateness Penalty Deduction", "1000.00"],
        ])
        expect(formatMinor(entry.totals.netMinor)).toBe("31000.00")
    })

    it("carries the source, so a disputed line is traceable", () => {
        const entry = buildEntry(person({
            adjustments: [{ type: "DEDUCTION", days: 1, source: "DAY_OFF", sourceId: "req-9" }],
        }))
        expect(entry.lines[1]).toMatchObject({ source: "DAY_OFF", sourceId: "req-9", label: "Deduction" })
    })

    it("values a day by the month's own length", () => {
        // valueDaysIn's rule once more: one day in February is worth more than
        // one in January, because both are a fraction of the same salary.
        const feb = buildEntry({
            ...person({ adjustments: [{ type: "BONUS", days: 1, source: "MANUAL" }] }),
            timeline: timelineForMonth([HIRED], 2026, 2, CAIRO),
        })
        expect(formatMinor(feb.lines[1].amountMinor)).toBe("1071.43") // 30,000 / 28
    })

    it("drops a line worth nothing rather than printing 0.00", () => {
        const entry = buildEntry(person({
            // A boundary probe, not a realistic entry: small enough that the
            // month's day rate rounds it to nothing.
            adjustments: [{ type: "BONUS", days: 0.000001, source: "MANUAL" }],
        }))
        expect(entry.lines).toHaveLength(1)
    })
})

describe("the net never goes below zero", () => {
    it("carries the excess out as debt instead", () => {
        // A payslip is a statement of what is being paid, and negative pay is
        // not a thing that happens. The rest becomes a debt with its own due
        // date — see totalPayslip.
        const entry = buildEntry(person({
            adjustments: [{ type: "DEDUCTION", days: 40, reason: "Advance repayment", source: "MANUAL" }],
        }))
        expect(entry.totals.netMinor).toBe(0)
        expect(formatMinor(entry.totals.carriedMinor)).toBe("10000.00")
    })
})

describe("the register is what somebody signs off", () => {
    const people = [
        person({ userId: "a", name: "A" }),
        person({ userId: "b", name: "B" }),
        person({ userId: "c", name: "C", exclusion: { reason: "On unpaid leave" } }),
    ]

    it("totals only what will be paid", () => {
        const register = buildRegister(people, 2026, 9)
        expect(formatMinor(register.payableMinor)).toBe("60000.00")
        expect(register.includedCount).toBe(2)
        expect(register.excludedCount).toBe(1)
    })

    it("keeps an excluded person on the register, with the reason", () => {
        // A person left out with no row at all is a person nobody notices is
        // missing, which is the failure a register exists to prevent.
        const register = buildRegister(people, 2026, 9)
        const excluded = register.entries.find(e => e.userId === "c")!
        expect(excluded.excluded).toBe(true)
        expect(excluded.exclusionReason).toBe("On unpaid leave")
    })

    it("names the months that are not finished being decided", () => {
        const undecided = person({ userId: "d", name: "D" }, [
            HIRED, ev("SUSPENDED", local(2026, 9, 26)),
        ])
        const register = buildRegister([...people, undecided], 2026, 9)
        expect(register.pendingDecisions).toEqual([{ userId: "d", name: "D", undecidedDays: 5 }])
        // And the total still includes them: an unanswered question must not
        // silently become a deduction.
        expect(formatMinor(register.payableMinor)).toBe("90000.00")
    })

    it("refuses a person with no salary in force rather than paying them zero", () => {
        expect(() => buildEntry(person({ rates: [] }))).toThrow(/No salary in effect/)
    })
})

describe("variance answers the question a reviewer actually asks", () => {
    const entries = buildRegister([
        person({ userId: "a", name: "A" }),
        person({ userId: "b", name: "B", adjustments: [{ type: "BONUS", days: 3, source: "MANUAL" }] }),
    ], 2026, 9).entries

    it("shows what moved, per person", () => {
        const v = variance(entries, [
            { userId: "a", name: "A", netMinor: toMinor(30_000) },
            { userId: "b", name: "B", netMinor: toMinor(30_000) },
        ])
        expect(formatMinor(v.deltaMinor)).toBe("3000.00")
        expect(v.people.find(p => p.userId === "b")).toMatchObject({ kind: "CHANGED" })
        expect(v.people.find(p => p.userId === "a")).toMatchObject({ kind: "SAME", deltaMinor: 0 })
    })

    it("marks somebody new", () => {
        const v = variance(entries, [{ userId: "a", name: "A", netMinor: toMinor(30_000) }])
        expect(v.people.find(p => p.userId === "b")).toMatchObject({ kind: "NEW", previousMinor: null })
    })

    it("keeps somebody who has gone, rather than letting them vanish", () => {
        // A row that disappears is the change nobody sees.
        const v = variance(entries, [
            { userId: "a", name: "A", netMinor: toMinor(30_000) },
            { userId: "b", name: "B", netMinor: toMinor(33_000) },
            { userId: "z", name: "Z", netMinor: toMinor(12_000) },
        ])
        const gone = v.people.find(p => p.userId === "z")!
        expect(gone).toMatchObject({ kind: "GONE", currentMinor: null })
        expect(formatMinor(gone.deltaMinor)).toBe("-12000.00")
    })

    it("sorts by how much moved, not by name", () => {
        const v = variance(entries, [
            { userId: "a", name: "A", netMinor: toMinor(30_000) },
            { userId: "b", name: "B", netMinor: toMinor(1_000) },
        ])
        expect(v.people[0].userId).toBe("b")
    })
})

describe("issuing resumes rather than restarting", () => {
    const slips = (n: number, sentUpTo = 0) =>
        Array.from({ length: n }, (_, i) => ({
            id: `p${i}`,
            emailedAt: i < sentUpTo ? new Date() : null,
        }))

    it("sends at most a batch at a time", () => {
        const { batch, remaining, total } = nextIssueBatch(slips(60))
        expect(ISSUE_BATCH_SIZE).toBe(25)
        expect(batch).toHaveLength(25)
        expect(remaining).toBe(35)
        expect(total).toBe(60)
    })

    it("picks up where it stopped", () => {
        // The cap matters less than this. A retry that restarted would send
        // twenty-five people their payslip twice.
        const { batch, remaining } = nextIssueBatch(slips(60, 25))
        expect(batch.map(p => p.id)).toEqual(Array.from({ length: 25 }, (_, i) => `p${i + 25}`))
        expect(remaining).toBe(10)
    })

    it("is empty once everything has gone", () => {
        expect(nextIssueBatch(slips(10, 10))).toMatchObject({ batch: [], remaining: 0 })
    })

    it("never sends an excluded payslip", () => {
        // They are on the register to be seen, not to be issued.
        const mixed = [
            { id: "a", emailedAt: null, excluded: true },
            { id: "b", emailedAt: null, excluded: false },
        ]
        expect(nextIssueBatch(mixed).batch.map(p => p.id)).toEqual(["b"])
        expect(nextIssueBatch(mixed).total).toBe(1)
    })
})
