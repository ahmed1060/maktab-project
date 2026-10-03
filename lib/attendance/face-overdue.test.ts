import { describe, it, expect } from "vitest"
import { reverifyOverdue, workingDaysSince } from "./face-overdue"

// Sunday to Thursday, as in Egypt.
const SUN_THU = [0, 1, 2, 3, 4]

describe("re-verification overdue (ATTENDANCE_PLAN.md §9.5)", () => {
    it("counts only working days after the request", () => {
        // Thursday 2026-10-01 asked; Fri and Sat off; Sun, Mon, Tue work.
        expect(workingDaysSince("2026-10-01", "2026-10-01", SUN_THU)).toBe(0)
        expect(workingDaysSince("2026-10-01", "2026-10-03", SUN_THU)).toBe(0)
        expect(workingDaysSince("2026-10-01", "2026-10-06", SUN_THU)).toBe(3)
        expect(workingDaysSince("2026-10-01", "2026-10-07", SUN_THU)).toBe(4)
    })

    it("is overdue after three full working days, not on the third", () => {
        expect(reverifyOverdue("2026-10-01", "2026-10-06", SUN_THU)).toBe(false)
        expect(reverifyOverdue("2026-10-01", "2026-10-07", SUN_THU)).toBe(true)
    })
})
