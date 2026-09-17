import { describe, it, expect } from "vitest"
import { planReset, MAX_RECONSTRUCTED_YEARS, RECONSTRUCTED_NOTE } from "./leave-reset"

describe("the reset owes a snapshot for every year it missed", () => {
    it("writes one for the ordinary case", () => {
        const plan = planReset(2025, 2026)
        expect(plan).toEqual({ kind: "RESET", years: [{ year: 2025, reconstructed: false }] })
    })

    it("writes one per year when a January was missed", () => {
        // The bug this replaces: the old code wrote a single snapshot for 2024
        // and then set lastDayOffResetYear straight to 2026. 2025 got no row —
        // and because the table is unique on [userId, year], it never could.
        const plan = planReset(2024, 2026)
        expect(plan).toEqual({
            kind: "RESET",
            years: [
                { year: 2024, reconstructed: false },
                { year: 2025, reconstructed: true },
            ],
        })
    })

    it("marks every year but the first as reconstructed", () => {
        // Only the first has a balance anybody measured: the credit sitting on
        // the account descends from that year's allowance and kept running down
        // through the rest, because no reset came along to re-grant it.
        const plan = planReset(2020, 2026)
        expect(plan.kind).toBe("RESET")
        if (plan.kind !== "RESET") return
        expect(plan.years.map(y => y.year)).toEqual([2020, 2021, 2022, 2023, 2024, 2025])
        expect(plan.years.filter(y => !y.reconstructed)).toHaveLength(1)
        expect(plan.years[0].reconstructed).toBe(false)
    })

    it("does not snapshot the year currently running", () => {
        // The allowance for 2026 has not finished yet. Its closing balance is
        // next January's business.
        const plan = planReset(2025, 2026)
        expect(plan.kind === "RESET" && plan.years.some(y => y.year === 2026)).toBe(false)
    })

    it("does nothing when the reset is already up to date", () => {
        expect(planReset(2026, 2026)).toEqual({ kind: "UP_TO_DATE" })
        // Ahead of the clock — an account created in the last hours of 31
        // December is stamped with the year that is about to start.
        expect(planReset(2027, 2026)).toEqual({ kind: "UP_TO_DATE" })
    })
})

describe("an implausible span is surfaced, not acted on", () => {
    it("refuses a year that cannot be a missed run", () => {
        const plan = planReset(0, 2026)
        expect(plan).toEqual({ kind: "REFUSED", span: 2026 })
    })

    it("accepts right up to the bound and refuses just past it", () => {
        expect(planReset(2026 - MAX_RECONSTRUCTED_YEARS, 2026).kind).toBe("RESET")
        expect(planReset(2026 - MAX_RECONSTRUCTED_YEARS - 1, 2026).kind).toBe("REFUSED")
    })

    it("refuses a year that is not a whole number", () => {
        expect(planReset(NaN, 2026).kind).toBe("REFUSED")
        expect(planReset(2025.5, 2026).kind).toBe("REFUSED")
    })
})

describe("the note", () => {
    it("says the balance was carried rather than measured", () => {
        // A reconstructed closing balance is a different kind of fact from one
        // somebody wrote down at the time, and the row has to admit which it is.
        expect(RECONSTRUCTED_NOTE).toMatch(/did not run/)
        expect(RECONSTRUCTED_NOTE).toMatch(/carried through/)
    })
})
