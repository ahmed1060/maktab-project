import { describe, it, expect } from "vitest"
import type { TaxClaimRow } from "./tax-claims"

/**
 * What the client's area shows of a client's tax position
 * (CLIENT_PORTAL_PLAN.md §6, §12 step 8a; DESIGN.md §5.5; PR 336): what's
 * owed by item, largest first; how late, from what's not due yet to more
 * than 2 years since the due date (decided 2026-11-19); and the oldest
 * delay. lib/portal-tax.db.test.ts has the read, against a real Postgres.
 */

const claim = (over: Partial<TaxClaimRow> & { id: string }): TaxClaimRow => ({
    claimNumber: over.id, item: "إقرار ضريبة الدخل", taxType: null, registrationType: null,
    originalAmount: 100, paidAmount: 0, remainingAmount: 100, currency: "جنيه مصري", status: null,
    periodStart: null, periodEnd: null, dueDate: "2026-01-31", daysLate: 0,
    ...over,
})

describe("how late a claim is, by time since its due date", () => {
    const group = async (dueDate: string, today: string) => (await import("./portal-tax")).lateGroup(dueDate, today)

    it("in five groups, in their order, the first for what's not due yet", async () => {
        const { LATE_GROUPS } = await import("./portal-tax")
        expect(LATE_GROUPS).toEqual(["not_due", "under_6_months", "6_to_12_months", "1_to_2_years", "over_2_years"])
    })

    it("not due yet until its last day to pay has passed, that day too", async () => {
        expect(await group("2026-11-19", "2026-11-18")).toBe("not_due")
        expect(await group("2026-11-19", "2026-11-19")).toBe("not_due")
        expect(await group("2026-11-19", "2026-11-20")).toBe("under_6_months")
    })

    it("then by whole months since that day: 6 months, a year and 2 years start the next groups", async () => {
        expect(await group("2026-05-19", "2026-11-18")).toBe("under_6_months")
        expect(await group("2026-05-19", "2026-11-19")).toBe("6_to_12_months")
        expect(await group("2025-11-19", "2026-11-18")).toBe("6_to_12_months")
        expect(await group("2025-11-19", "2026-11-19")).toBe("1_to_2_years")
        expect(await group("2024-11-19", "2026-11-18")).toBe("1_to_2_years")
        expect(await group("2024-11-19", "2026-11-19")).toBe("over_2_years")
        expect(await group("2019-01-01", "2026-11-19")).toBe("over_2_years")
    })

    it("a month too short for the day counts from its last day", async () => {
        // 31 August and 6 months: the end of February.
        expect(await group("2026-08-31", "2027-02-27")).toBe("under_6_months")
        expect(await group("2026-08-31", "2027-02-28")).toBe("6_to_12_months")
        // A leap year's 29 February and a year: 28 February.
        expect(await group("2028-02-29", "2029-02-27")).toBe("6_to_12_months")
        expect(await group("2028-02-29", "2029-02-28")).toBe("1_to_2_years")
    })
})

describe("what's owed, by item", () => {
    const items = async (claims: TaxClaimRow[]) => (await import("./portal-tax")).byItem(claims)

    it("each item's claims, in the order they came, with what they come to", async () => {
        const groups = await items([
            claim({ id: "a1", item: "VAT", originalAmount: 500.5, paidAmount: 200.25, remainingAmount: 300.25, dueDate: "2026-09-30", daysLate: 50 }),
            claim({ id: "b1", item: "Income", originalAmount: 1000, remainingAmount: 1000, dueDate: "2026-04-30", daysLate: 203 }),
            claim({ id: "a2", item: "VAT", originalAmount: 300, remainingAmount: 300, dueDate: "2026-11-30", daysLate: 0 }),
        ])
        expect(groups).toEqual([
            { item: "Income", claims: [expect.objectContaining({ id: "b1" })], original: 1000, paid: 0, remaining: 1000, earliestDue: "2026-04-30", badges: ["late"] },
            { item: "VAT", claims: [expect.objectContaining({ id: "a1" }), expect.objectContaining({ id: "a2" })], original: 800.5, paid: 200.25, remaining: 600.25, earliestDue: "2026-09-30", badges: ["partly_paid", "late"] },
        ])
    })

    it("the largest remaining first, and items owing the same by name", async () => {
        const groups = await items([
            claim({ id: "1", item: "B", remainingAmount: 50 }),
            claim({ id: "2", item: "C", remainingAmount: 900 }),
            claim({ id: "3", item: "A", remainingAmount: 50 }),
        ])
        expect(groups.map(g => g.item)).toEqual(["C", "A", "B"])
    })

    it("the earliest due date of its claims, whatever their order", async () => {
        const [group] = await items([claim({ id: "1", dueDate: "2026-06-30" }), claim({ id: "2", dueDate: "2026-02-28" })])
        expect(group.earliestDue).toBe("2026-02-28")
    })

    it("only the badges its claims have", async () => {
        const [group] = await items([claim({ id: "1", daysLate: 0, paidAmount: 0 })])
        expect(group.badges).toEqual([])
    })

    it("sums to the cent, as money is", async () => {
        const [group] = await items([claim({ id: "1", remainingAmount: 0.1, originalAmount: 0.1 }), claim({ id: "2", remainingAmount: 0.2, originalAmount: 0.2 })])
        expect(group.remaining).toBe(0.3)
        expect(group.original).toBe(0.3)
    })

    it("nothing where there are no claims", async () => {
        expect(await items([])).toEqual([])
    })

    // §3.3: the portal spells the same item more than one way.
    it("spellings of one item are one item, letter forms, vowel marks, spaces and dashes aside; each claim keeps its own", async () => {
        const groups = await items([
            claim({ id: "1", item: "مساهمة تكافلية- تأمين صحي", originalAmount: 100, remainingAmount: 100 }),
            claim({ id: "2", item: "مساهمه تكافليه - تامين صحى", originalAmount: 200, remainingAmount: 200 }),
            claim({ id: "3", item: "مُساهمة تكافلية -  تأمين صحي", originalAmount: 50.1, remainingAmount: 50.1 }),
        ])
        expect(groups).toHaveLength(1)
        expect(groups[0]).toMatchObject({ original: 350.1, remaining: 350.1 })
        expect(groups[0].claims.map(c => c.item)).toEqual(["مساهمة تكافلية- تأمين صحي", "مساهمه تكافليه - تامين صحى", "مُساهمة تكافلية -  تأمين صحي"])
    })

    it("the usual items in their correct spelling, however the portal wrote them", async () => {
        const groups = await items([
            claim({ id: "1", item: "أقرار تجاري", remainingAmount: 300 }),
            claim({ id: "2", item: "أقرار تجاري", remainingAmount: 200 }),
            claim({ id: "3", item: "اقرار شهرى", remainingAmount: 100 }),
            claim({ id: "4", item: "مساهمه تكافليه - تامين صحى", remainingAmount: 50 }),
        ])
        expect(groups.map(g => g.item)).toEqual(["إقرار تجاري", "إقرار شهري", "مساهمة تكافلية - تأمين صحي"])
    })

    it("any other item as the portal wrote it most often", async () => {
        // The other spelling comes first, and first in text order too.
        const groups = await items([
            claim({ id: "1", item: "غرامة -تأخير" }),
            claim({ id: "2", item: "غرامة تأخير" }),
            claim({ id: "3", item: "غرامة تأخير" }),
        ])
        expect(groups.map(g => g.item)).toEqual(["غرامة تأخير"])
    })

    it("two spellings written as often go by text order, whatever order the claims come in", async () => {
        const one = claim({ id: "1", item: "غرامه تأخير" })
        const other = claim({ id: "2", item: "غرامة تأخير" })
        expect((await items([one, other])).map(g => g.item)).toEqual(["غرامة تأخير"])
        expect((await items([other, one])).map(g => g.item)).toEqual(["غرامة تأخير"])
    })

    it("another word is another item", async () => {
        const groups = await items([claim({ id: "1", item: "أقرار تجاري", remainingAmount: 20 }), claim({ id: "2", item: "أقرار صناعي", remainingAmount: 10 })])
        expect(groups.map(g => g.item)).toEqual(["إقرار تجاري", "أقرار صناعي"])
    })
})

describe("what's owed, by how late", () => {
    const late = async (claims: TaxClaimRow[], today: string) => (await import("./portal-tax")).byLate(claims, today)

    it("every group, in order, with what remains in it and how many claims", async () => {
        const rows = await late([
            claim({ id: "1", dueDate: "2026-12-31", remainingAmount: 40 }),
            claim({ id: "2", dueDate: "2026-11-17", remainingAmount: 300 }),
            claim({ id: "3", dueDate: "2026-04-30", remainingAmount: 1000 }),
            claim({ id: "4", dueDate: "2026-11-18", remainingAmount: 75.1 }),
            claim({ id: "5", dueDate: "2023-01-31", remainingAmount: 12.2 }),
        ], "2026-11-19")
        expect(rows).toEqual([
            { group: "not_due", remaining: 40, count: 1 },
            { group: "under_6_months", remaining: 375.1, count: 2 },
            { group: "6_to_12_months", remaining: 1000, count: 1 },
            { group: "1_to_2_years", remaining: 0, count: 0 },
            { group: "over_2_years", remaining: 12.2, count: 1 },
        ])
    })

    it("all five at nothing where there are no claims", async () => {
        expect((await late([], "2026-11-19")).map(r => [r.remaining, r.count])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]])
    })
})

describe("the oldest delay", () => {
    const oldest = async (claims: TaxClaimRow[]) => (await import("./portal-tax")).oldestDelay(claims)

    it("the most days any claim is late", async () => {
        expect(await oldest([claim({ id: "1", daysLate: 3 }), claim({ id: "2", daysLate: 203 }), claim({ id: "3", daysLate: 0 })])).toBe(203)
    })

    it("none where nothing is late", async () => {
        expect(await oldest([claim({ id: "1", daysLate: 0 })])).toBe(0)
        expect(await oldest([])).toBe(0)
    })
})

describe("the whole of it, as the page is given it", () => {
    it("what's owed in all, how many claims are open and late, the oldest delay, by item and by how late", async () => {
        const { summarise } = await import("./portal-tax")
        const claims = [
            claim({ id: "1", item: "Income", originalAmount: 1000, remainingAmount: 1000, dueDate: "2026-04-30", daysLate: 202 }),
            claim({ id: "2", item: "VAT", originalAmount: 500.5, paidAmount: 200.25, remainingAmount: 300.25, dueDate: "2026-09-30", daysLate: 49 }),
            claim({ id: "3", item: "Takaful", originalAmount: 50, paidAmount: 10, remainingAmount: 40, dueDate: "2026-12-31", daysLate: 0 }),
        ]
        const position = summarise(claims, "2026-11-18", "2026-10-14")
        expect(position.today).toBe("2026-11-18")
        expect(position.asOf).toBe("2026-10-14")
        expect(position.totals).toEqual({ original: 1550.5, paid: 210.25, remaining: 1340.25, open: 3, late: 2, oldestDelay: 202 })
        expect(position.items.map(i => i.item)).toEqual(["Income", "VAT", "Takaful"])
        expect(position.late.map(r => r.count)).toEqual([1, 1, 1, 0, 0])
    })

    it("before the first upload: nothing owed, and no day the figures are from", async () => {
        const { summarise } = await import("./portal-tax")
        expect(summarise([], "2026-11-18", null)).toEqual({
            today: "2026-11-18", asOf: null,
            totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0, oldestDelay: 0 },
            items: [],
            late: expect.arrayContaining([{ group: "not_due", remaining: 0, count: 0 }]),
        })
    })
})
