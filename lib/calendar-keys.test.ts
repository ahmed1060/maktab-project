import { describe, it, expect, vi, afterEach } from "vitest"
import { moveDay, monthOf } from "./calendar-keys"
import { startDay } from "./usePickerKeyboard"

/**
 * Moving around the date pickers' calendars from the keyboard. The pickers
 * couldn't be opened or used without a mouse, so a keyboard user couldn't
 * set a task deadline, an obligation date or a day off (accessibility audit,
 * 4 October 2026, C1).
 */
describe("arrow keys in a calendar", () => {
    it("move a day and a week, across the end of a month", () => {
        expect(moveDay("2026-10-31", "ArrowRight", false)).toBe("2026-11-01")
        expect(moveDay("2026-10-01", "ArrowLeft", false)).toBe("2026-09-30")
        expect(moveDay("2026-10-28", "ArrowDown", false)).toBe("2026-11-04")
        expect(moveDay("2026-10-03", "ArrowUp", false)).toBe("2026-09-26")
    })

    it("follow reading direction in Arabic: the right arrow is the day before", () => {
        expect(moveDay("2026-10-15", "ArrowRight", true)).toBe("2026-10-14")
        expect(moveDay("2026-10-15", "ArrowLeft", true)).toBe("2026-10-16")
    })

    it("Home and End go to the start and end of the week (Sunday to Saturday)", () => {
        expect(moveDay("2026-10-15", "Home", false)).toBe("2026-10-11")
        expect(moveDay("2026-10-15", "End", false)).toBe("2026-10-17")
    })

    it("Page Up and Down move a month, to its last day when shorter", () => {
        expect(moveDay("2026-01-31", "PageDown", false)).toBe("2026-02-28")
        expect(moveDay("2026-03-15", "PageUp", false)).toBe("2026-02-15")
        expect(moveDay("2026-12-10", "PageDown", false)).toBe("2027-01-10")
    })

    it("other keys don't move", () => {
        expect(moveDay("2026-10-15", "a", false)).toBeNull()
        expect(moveDay("2026-10-15", "Enter", false)).toBeNull()
    })

    it("gives the month to show for a day", () => {
        expect(monthOf("2026-10-15").getMonth()).toBe(9)
        expect(monthOf("2026-10-15").getDate()).toBe(1)
    })
})

describe("the day a picker opens on", () => {
    afterEach(() => vi.useRealTimers())

    it("is the chosen day, else today, else the nearest allowed day", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 9, 4, 12))
        expect(startDay("2026-10-20", null, null)).toBe("2026-10-20")
        expect(startDay(null, null, null)).toBe("2026-10-04")
        expect(startDay(null, "2026-11-01", null)).toBe("2026-11-01")
        expect(startDay(null, null, "2026-09-30")).toBe("2026-09-30")
        // A chosen day that's no longer allowed isn't where it opens.
        expect(startDay("2026-09-01", "2026-10-01", null)).toBe("2026-10-04")
    })
})
