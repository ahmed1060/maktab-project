import { describe, it, expect } from "vitest"
import { costsDue, dueParts, namedParts, payWording } from "./costs-total"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

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

describe("the parts Mark all as paid confirms (CLIENTS_PLAN.md §4.1)", () => {
    it("are each share still owed, and the part of the cost that's no one's share", () => {
        expect(dueParts([{ id: "t", totalCost: 25, memberCosts: { amal: 10, omar: 5 }, memberPaymentStatus: { omar: "PAID" } }])).toEqual([
            { taskId: "t", userId: "amal", amount: 10 },
            { taskId: "t", userId: null, amount: 10 },
        ])
        // Not split at all: the whole cost is the task's own.
        expect(dueParts([{ id: "u", totalCost: 40, memberCosts: {}, memberPaymentStatus: {} }])).toEqual([{ taskId: "u", userId: null, amount: 40 }])
    })

    it("with an employee picked, are their shares only", () => {
        expect(dueParts([{ id: "t", totalCost: 25, memberCosts: { amal: 10, omar: 5 }, memberPaymentStatus: {} }], "omar")).toEqual([{ taskId: "t", userId: "omar", amount: 5 }])
    })
})

describe("what Mark all as paid's window says (CLIENTS_PLAN.md §4.1)", () => {
    const say = (dict: Record<string, string>) => (key: string) => dict[key]
    it("counts the costs, and says one cost as one", () => {
        expect(payWording(say(en) as any, "en", 7, 3450).button).toBe("Pay 7 costs, 3,450.00 EGP")
        expect(payWording(say(en) as any, "en", 1, 850).button).toBe("Pay 1 cost, 850.00 EGP")
        expect(payWording(say(en) as any, "en", 1, 850).question).toMatch(/^Pay 1 cost, 850\.00 EGP\? Only this is paid/)
    })
    it("in Arabic too, with Arabic numerals", () => {
        expect(payWording(say(ar) as any, "ar", 7, 3450).button).toBe("دفع ٧ من التكاليف بقيمة ٣٬٤٥٠٫٠٠ ج.م")
        expect(payWording(say(ar) as any, "ar", 1, 850).button).toBe("دفع تكلفة واحدة بقيمة ٨٥٠٫٠٠ ج.م")
    })
})

describe("Mark all as paid's name in Arabic", () => {
    // Said as paying one task is, "تحديد كمدفوع": it read "تحدد" ("you mark").
    it("starts as Mark as paid's does", () => {
        expect(ar.mark_all_as_paid.split(" ")[0]).toBe(ar.mark_as_paid.split(" ")[0])
    })
})

describe("what's due of the costs of one name (CLIENTS_PLAN.md §5.9)", () => {
    // Each task's costs here are those of the name, as the Costs page fetches them.
    const tasks = [
        // Sara's two Transport costs and Omar's, Omar's share paid already.
        { id: "t1", memberCosts: { sara: 150, omar: 60 }, memberPaymentStatus: { omar: "PAID" }, costs: [{ authorId: "sara", amount: 40 }, { authorId: "sara", amount: "12.5" }, { authorId: "omar", amount: 20 }] },
        // One from before costs had their person: the task's own.
        { id: "t2", memberCosts: { sara: 30 }, memberPaymentStatus: {}, costs: [{ authorId: null, amount: 75.25 }, { authorId: "sara", amount: 0.1 }, { authorId: "sara", amount: 0.2 }] },
    ]

    it("is each person's costs of it while their share is owed, and those no one's", () => {
        expect(namedParts(tasks)).toEqual([
            { taskId: "t1", userId: "sara", amount: 52.5 },
            { taskId: "t2", userId: null, amount: 75.25 },
            // To the piastre, not 0.30000000000000004.
            { taskId: "t2", userId: "sara", amount: 0.3 },
        ])
    })

    it("is only theirs with an employee picked", () => {
        expect(namedParts(tasks, "sara").map(p => [p.taskId, p.amount])).toEqual([["t1", 52.5], ["t2", 0.3]])
        expect(namedParts(tasks, "omar")).toEqual([])
    })

    it("is only what's to be paid back of each, never what a cash advance paid (§7.8)", () => {
        const fromAdvance = [
            // Nadia's whole Transport cost from her advance: none of it is her share.
            { id: "t3", memberCosts: { sara: 25 }, memberPaymentStatus: {}, costs: [{ authorId: "nadia", amount: 80, fromAdvance: 80 }, { authorId: "sara", amount: 40, fromAdvance: "15" }] },
        ]
        expect(namedParts(fromAdvance)).toEqual([{ taskId: "t3", userId: "sara", amount: 25 }])
        expect(namedParts(fromAdvance, "nadia")).toEqual([])
    })
})
