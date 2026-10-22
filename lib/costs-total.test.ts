import { describe, it, expect } from "vitest"
import { costsDue } from "./costs-total"

/**
 * The Costs page's total (CLIENTS_PLAN.md §3.5): what's still due across
 * every page of the filtered list, or one employee's share of it.
 */

const TASKS = [
    // Split between two people, one of them paid already.
    { totalCost: 300, memberCosts: { amal: 100, omar: 200 }, memberPaymentStatus: { amal: "PAID", omar: "PENDING_PAYMENT" } },
    // Split, neither paid, as stored by an older release: JSON text.
    { totalCost: 50.1, memberCosts: '{"amal": 30.05, "omar": 20.05}', memberPaymentStatus: null },
    // A cost with no split: due whole, and nobody's share.
    { totalCost: "75.5", memberCosts: {}, memberPaymentStatus: {} },
]

describe("the Costs page's total", () => {
    it("adds up what's still due across the whole list, leaving out the parts paid", () => {
        expect(costsDue(TASKS)).toBe(200 + 30.05 + 20.05 + 75.5)
    })

    it("with an employee picked, is their share still due", () => {
        expect(costsDue(TASKS, "omar")).toBe(220.05)
        expect(costsDue(TASKS, "amal")).toBe(30.05)
        expect(costsDue(TASKS, "nobody")).toBe(0)
    })

    it("counts what of a cost is no one's share, as the page's own card for the task does", () => {
        // A cost from before shares, beside a share added since: 40 is no one's.
        const both = { totalCost: 100, memberCosts: { amal: 60 }, memberPaymentStatus: {} }
        expect(costsDue([both])).toBe(100)
        // It's the task's, not anyone's, so not in an employee's share.
        expect(costsDue([both], "amal")).toBe(60)
    })

    it("is nothing for an empty list, and ignores what isn't a number", () => {
        expect(costsDue([])).toBe(0)
        expect(costsDue([{ totalCost: 0, memberCosts: { amal: "abc" }, memberPaymentStatus: {} }])).toBe(0)
    })
})
