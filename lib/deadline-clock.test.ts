import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { nextLook } from "./useDeadlineClock"

/**
 * A page with a deadline looks at it again just after it passes
 * (lib/useDeadlineClock.ts). The deadline can change while the page is open,
 * edited and the page refreshed, so the wait is from the time it is now, not
 * the time the page was last drawn at (found by Codex on PR 123).
 */
const at = (hhmm: string) => Date.parse(`2026-10-30T${hhmm}:00Z`)

describe("the next look at a deadline", () => {
    it("waits from the time it is now when the deadline moved later", () => {
        // Opened at 9, the deadline moved at 10 to 2: four hours, not five.
        expect(nextLook(at("14:00"), at("09:00"), at("10:00"))).toBe(4 * 3_600_000 + 500)
    })

    it("looks at once when the deadline moved to a time already passed", () => {
        expect(nextLook(at("09:30"), at("09:00"), at("10:00"))).toBe(0)
    })

    it("waits for nothing once the deadline shows as passed", () => {
        expect(nextLook(at("09:30"), at("09:31"), at("10:00"))).toBeNull()
    })

    it("takes a newer time from a fresh drawing on the server, and waits from the time it is now", () => {
        const hook = readFileSync("lib/useDeadlineClock.ts", "utf8")
        expect(hook).toContain("const shown = Math.max(clock, now)")
        expect(hook).toContain("nextLook(deadlineAt, shown, Date.now())")
    })
})
