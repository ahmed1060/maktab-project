import { describe, it, expect } from "vitest"
import { chargeState, feeFor, totalFor, SERVICE_FEE_MAX } from "./charges"
import { shows, type SideBarViewer } from "./side-bar"

/**
 * Client charges (CLIENTS_PLAN.md §6): Paid | Service fee | Total, a charge's
 * status, and who finds the Costs page.
 */
describe("a charge's service fee and total (§6.3)", () => {
    it("works out the total from the fee, and the fee from the total, to the piastre", () => {
        expect(totalFor(250.5, 49.5)).toBe(300)
        expect(totalFor(0.1, 0.2)).toBe(0.3)
        expect(feeFor(250.5, 300)).toBe(49.5)
        expect(feeFor(100, 100)).toBe(0)
        expect(feeFor(10.1, 10.3)).toBe(0.2)
    })

    it("takes no fee below nothing, so no total below what was paid, nor one past the most", () => {
        expect(totalFor(100, -1)).toBeNull()
        expect(totalFor(100, NaN)).toBeNull()
        expect(totalFor(100, SERVICE_FEE_MAX + 1)).toBeNull()
        expect(feeFor(100, 99.99)).toBeNull()
        expect(feeFor(100, NaN)).toBeNull()
        expect(feeFor(100, 100 + SERVICE_FEE_MAX + 1)).toBeNull()
    })
})

describe("a charge's status (§6.4)", () => {
    it("is Due, Collected, or left off its client's bill", () => {
        expect(chargeState({ notCharged: false, collectedAt: null })).toBe("due")
        expect(chargeState({ notCharged: false, collectedAt: "2026-10-25T09:00:00Z" })).toBe("collected")
        expect(chargeState({ notCharged: true, collectedAt: null })).toBe("not_charged")
    })
})

describe("the Costs page in the side bar", () => {
    const only = (granted: string[]): SideBarViewer => ({
        superAdmin: false, can: p => granted.includes(p), companyWide: p => granted.includes(p), attendance: true, checkIn: false, companySettings: false,
    })
    it("is for whoever pays costs, or sees what clients are charged", () => {
        expect(shows("costs", only(["tasks.pay"]))).toBe(true)
        expect(shows("costs", only(["charges.view"]))).toBe(true)
        expect(shows("costs", only(["tasks.view"]))).toBe(false)
    })
})
