import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { spansDays } from "./day-off-range"

describe("a day-off request's dates", () => {
    it("show both ends from two days up", () => {
        expect(spansDays("2026-10-20T00:00:00.000Z", "2026-10-21T00:00:00.000Z")).toBe(true)
        expect(spansDays("2026-10-20T00:00:00.000Z", "2026-10-25T00:00:00.000Z")).toBe(true)
    })

    it("show one day when there's no end, or it's the same day", () => {
        expect(spansDays("2026-10-20T00:00:00.000Z", null)).toBe(false)
        expect(spansDays("2026-10-20T00:00:00.000Z", undefined)).toBe(false)
        expect(spansDays("2026-10-20T00:00:00.000Z", "2026-10-20T00:00:00.000Z")).toBe(false)
    })

    it("are what the Day Off list shows", () => {
        const page = readFileSync("app/(dashboard)/dashboard/day-off-requests/page.tsx", "utf8")
        expect(page).toContain("const range = (r: DayOffRequest) => spansDays(r.date, r.endDate)")
        expect(page).not.toContain("+ 86400000")
    })
})
