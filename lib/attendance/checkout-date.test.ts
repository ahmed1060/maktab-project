import { describe, it, expect } from "vitest"
import { checkoutDate } from "./checkout-date"

describe("where a missing check-out is filled in (review on #15)", () => {
    it("is the next morning for a night shift, the same day otherwise", () => {
        expect(checkoutDate("2026-09-30", 1800)).toBe("2026-10-01")
        expect(checkoutDate("2026-09-29", 1020)).toBe("2026-09-29")
        expect(checkoutDate("2026-09-29", null)).toBe("2026-09-29")
    })
})
