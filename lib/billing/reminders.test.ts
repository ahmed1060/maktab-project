import { describe, it, expect } from "vitest"
import { decideReminder, REMINDER_RUNGS } from "./reminders"

// A full run of the ladder, feeding each day's decision back in as state, so
// the tests exercise the sequence rather than isolated days.
function walk(days: number[], initial: number[] = []) {
    let sent = [...initial]
    const delivered: number[] = []
    for (const daysLeft of days) {
        const decision = decideReminder(daysLeft, sent)
        if (decision.send !== null) delivered.push(decision.send)
        sent = [...new Set([...sent, ...decision.markSent])]
    }
    return { delivered, sent }
}

describe("the ladder in normal operation", () => {
    it("delivers 14, then 3, then 1 — each exactly once", () => {
        const days = Array.from({ length: 20 }, (_, i) => 20 - i) // 20 down to 1
        expect(walk(days).delivered).toEqual([14, 3, 1])
    })

    it("sends nothing while the subscription is outside the window", () => {
        expect(walk([90, 60, 30, 15]).delivered).toEqual([])
    })

    it("never repeats a rung, however many times the job runs on the same day", () => {
        expect(walk([14, 14, 14, 14]).delivered).toEqual([14])
    })
})

describe("first observation does not fire a backlog", () => {
    it("first seen at day 5: gets 3 and 1, never 14", () => {
        // The rule the plan settled on. Firing all three rungs the morning the
        // ladder ships is what trains someone to stop reading them.
        const { delivered } = walk([5, 4, 3, 2, 1])
        expect(delivered).toEqual([3, 1])
    })

    it("first seen at day 5, the 14 rung is recorded as spent rather than pending", () => {
        const decision = decideReminder(5, [])
        expect(decision.send).toBeNull()
        expect(decision.markSent).toEqual([14])
    })

    it("first seen at day 2: gets only 1", () => {
        expect(walk([2, 1]).delivered).toEqual([1])
    })

    it("first seen at day 1: gets 1, since its own moment has not passed", () => {
        expect(walk([1]).delivered).toEqual([1])
    })

    it("first seen at day 14 is not a backlog case and fires normally", () => {
        const decision = decideReminder(14, [])
        expect(decision.send).toBe(14)
        expect(decision.markSent).toEqual([14])
    })

    it("the four existing subscriptions, entering the window on schedule, behave normally", () => {
        // Their remindersSent are all empty, and the nearest reaches day 14
        // exactly — so the backfill rule skips nothing for them.
        expect(walk([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]).delivered).toEqual([14, 3, 1])
    })
})

describe("a job that could not run for several days", () => {
    it("sends only the true rung, not every rung it missed", () => {
        // Down for days 13 through 2. "Expires in 3 days" and "expires in 1 day"
        // arriving together is worse than only the accurate one.
        const { delivered, sent } = walk([14, 1])
        expect(delivered).toEqual([14, 1])
        expect(sent.sort((a, b) => b - a)).toEqual([14, 3, 1])
    })

    it("spends the rungs it skipped, so they cannot fire late", () => {
        const decision = decideReminder(1, [14])
        expect(decision.send).toBe(1)
        expect(decision.markSent.sort((a, b) => b - a)).toEqual([3, 1])
    })

    it("first seen between two rungs sends nothing that day, then the next rung", () => {
        // Day 2 sits between rung 3 (whose moment has passed) and rung 1
        // (whose moment has not arrived), so the honest answer that morning is
        // silence. Rung 1 lands the following day.
        expect(walk([2]).delivered).toEqual([])
        expect(walk([2, 1]).delivered).toEqual([1])
    })

    it("a job that stops entirely after first observation sends nothing, by design", () => {
        // The accepted cost of refusing a backlog: rungs are only ever sent on a
        // run that happens. Nothing is queued up to fire late.
        expect(walk([5]).delivered).toEqual([])
    })
})

describe("guarantees that hold for every rung", () => {
    it("a rung is never sent unless the subscription has reached its threshold", () => {
        for (const daysLeft of [100, 30, 15]) {
            expect(decideReminder(daysLeft, []).send).toBeNull()
        }
    })

    it("whatever is sent is always recorded as sent", () => {
        for (let daysLeft = 1; daysLeft <= 20; daysLeft++) {
            for (const already of [[], [14], [14, 3], [...REMINDER_RUNGS]]) {
                const decision = decideReminder(daysLeft, already)
                if (decision.send !== null) {
                    expect(decision.markSent).toContain(decision.send)
                    expect(already).not.toContain(decision.send)
                }
            }
        }
    })

    it("once every rung is spent, nothing more is ever sent", () => {
        for (let daysLeft = 1; daysLeft <= 20; daysLeft++) {
            expect(decideReminder(daysLeft, [...REMINDER_RUNGS]).send).toBeNull()
        }
    })

    it("an expired or same-day subscription still sends the last rung once", () => {
        expect(decideReminder(0, [14, 3]).send).toBe(1)
        expect(decideReminder(0, [14, 3, 1]).send).toBeNull()
    })
})
