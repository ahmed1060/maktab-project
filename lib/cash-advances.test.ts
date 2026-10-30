import { describe, it, expect } from "vitest"
import { CASH_ADVANCE_MAX, balanceAfter, cashAdvancesInUse, dayOf, signedAmount } from "./cash-advances"

/** Cash advances' rules as the screens and the server both take them (CLIENTS_PLAN.md §7). */
describe("cash advances", () => {
    it("are used while the Super Admin allows them and the Admin has them on (§7.6)", () => {
        expect(cashAdvancesInUse({ cashAdvancesAllowed: true, cashAdvancesOn: true })).toBe(true)
        expect(cashAdvancesInUse({ cashAdvancesAllowed: true, cashAdvancesOn: false })).toBe(false)
        expect(cashAdvancesInUse({ cashAdvancesAllowed: false, cashAdvancesOn: true })).toBe(false)
        expect(cashAdvancesInUse(null)).toBe(false)
    })

    it("sign each entry's amount as the balance takes it, to the piastre (§7.4)", () => {
        expect(signedAmount("GIVEN", "1000")).toBe(1000)
        expect(signedAmount("GIVEN", 0.105)).toBe(0.11)
        expect(signedAmount("RETURNED", 300)).toBe(-300)
        expect(signedAmount("CORRECTION", -20.5)).toBe(-20.5)
        expect(signedAmount("CORRECTION", 20.5)).toBe(20.5)
        expect(signedAmount("GIVEN", CASH_ADVANCE_MAX)).toBe(CASH_ADVANCE_MAX)
    })

    it("refuse amounts that can't be one", () => {
        for (const raw of [0, 0.004, -1, "", " ", "x", null, undefined, NaN, Infinity, CASH_ADVANCE_MAX + 0.01]) {
            expect(signedAmount("GIVEN", raw), String(raw)).toBeNull()
        }
        expect(signedAmount("RETURNED", -5)).toBeNull()
        expect(signedAmount("CORRECTION", 0)).toBeNull()
        expect(signedAmount("CORRECTION", -CASH_ADVANCE_MAX - 1)).toBeNull()
    })

    it("never take a balance below zero", () => {
        expect(balanceAfter(700, -700)).toBe(0)
        expect(balanceAfter(0.3, -0.1)).toBe(0.2)
        expect(balanceAfter(700, -700.01)).toBeNull()
        expect(balanceAfter(0, 50)).toBe(50)
    })

    it("take a day only as a real day of the calendar", () => {
        expect(dayOf("2026-10-30")).toBe("2026-10-30")
        expect(dayOf("2028-02-29")).toBe("2028-02-29")
        for (const raw of ["2026-02-30", "2026-13-01", "30/10/2026", "2026-10-30T00:00", "", null, 20261030]) expect(dayOf(raw), String(raw)).toBeNull()
    })
})
