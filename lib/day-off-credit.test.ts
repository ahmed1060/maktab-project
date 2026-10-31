import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { usedDayOffCredit } from "./day-off-credit"

describe("day off credit used", () => {
    it("is this year's allowance less what's left", () => {
        expect(usedDayOffCredit(21, 18)).toBe(3)
        expect(usedDayOffCredit(21, 21)).toBe(0)
        expect(usedDayOffCredit(21, 20.5)).toBe(0.5)
    })

    it("is never below nothing, or made up from missing figures", () => {
        // Credit added by hand can leave more than the allowance.
        expect(usedDayOffCredit(21, 23)).toBe(0)
        expect(usedDayOffCredit(null, undefined)).toBe(0)
    })

    it("is the one answer on the dashboard and on the Requests page's Mine (UI_PLAN.md §2.3, part 2d)", () => {
        const dashboard = readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
        const requests = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")
        expect(dashboard).toContain("usedDayOffCredit(currentUser?.baseDayOffCredit, currentUser?.dayOffCredit)")
        expect(requests).toContain("usedDayOffCredit(balance.baseDayOffCredit ?? balance.dayOffCredit, balance.dayOffCredit)")
        // Not summed from approved requests, which counts salary days and past years.
        expect(dashboard).not.toMatch(/approvedRequests\.reduce/)
    })
})
