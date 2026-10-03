import { describe, it, expect } from "vitest"
import { addWorkingDays } from "./working-days"

describe("working days", () => {
    // 2026-09-27 is a Sunday.
    const sunday = new Date("2026-09-27T09:00:00Z")

    it("counts Sunday to Thursday", () => {
        expect(addWorkingDays(sunday, 3).toISOString()).toBe("2026-09-30T09:00:00.000Z")
    })

    it("steps over the weekend", () => {
        const wednesday = new Date("2026-09-30T09:00:00Z")
        // Thu, (Fri, Sat), Sun.
        expect(addWorkingDays(wednesday, 2).toISOString()).toBe("2026-10-04T09:00:00.000Z")
    })

    it("reads the weekday in the company's calendar, not UTC's", () => {
        // 22:30 UTC Thursday is already Friday in Cairo, so the next working
        // day there is Sunday.
        const lateThursday = new Date("2026-10-01T22:30:00Z")
        expect(addWorkingDays(lateThursday, 1, "Africa/Cairo").toISOString()).toBe("2026-10-03T22:30:00.000Z")
    })
})
