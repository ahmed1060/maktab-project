import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { spansDays, workDays } from "./day-off-range"

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

    it("are what the Requests page shows (UI_PLAN.md §2.3, part 2d)", () => {
        const page = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
        expect(page).toContain("return spansDays(d.from, d.to) ? `${day(d.from)} – ${day(d.to!)}` : day(d.from)")
        expect(page).not.toContain("+ 86400000")
    })
})

describe("the work days a request covers", () => {
    it("are every day but Friday, counted by calendar day wherever the screen is", () => {
        // Tuesday 3 to Thursday 5 November 2026.
        expect(workDays("2026-11-03T00:00:00.000Z", "2026-11-05T00:00:00.000Z")).toBe(3)
        // Thursday 5 to Saturday 7: Friday the 6th isn't one.
        expect(workDays("2026-11-05T00:00:00.000Z", "2026-11-07T00:00:00.000Z")).toBe(2)
        // One day, with no end.
        expect(workDays("2026-11-03T00:00:00.000Z", null)).toBe(1)
        // A Friday alone is none.
        expect(workDays("2026-11-06T00:00:00.000Z")).toBe(0)
    })
})
