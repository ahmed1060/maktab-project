import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { calendarDay } from "./calendar-day"

/**
 * A day picked in a form, such as a record's expiry date, shows as that day
 * wherever the browser is (Codex on #82).
 */
describe("a picked calendar day", () => {
    const zone = process.env.TZ
    afterEach(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone })

    it("is the same day in a browser west of UTC", () => {
        process.env.TZ = "America/Los_Angeles"
        // What the picker used to do: midnight UTC, the evening before in Los Angeles.
        expect(new Date("2026-10-20").getDate()).toBe(19)
        const day = calendarDay("2026-10-20")
        expect([day.getFullYear(), day.getMonth() + 1, day.getDate()]).toEqual([2026, 10, 20])
        expect(day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })).toBe("Oct 20, 2026")
    })

    it("is what the date picker shows", () => {
        const picker = readFileSync("components/DatePickerSingle.tsx", "utf8")
        expect(picker).toContain("return calendarDay(dateStr).toLocaleDateString(")
        expect(picker).not.toContain("const date = new Date(dateStr)")
    })
})
