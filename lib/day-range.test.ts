import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dayRange, parseDay } from "./day-range"
import { buildTaskWhereClause } from "./services/task-query"
import { withGrants } from "./permissions/test-actors"

/**
 * The Tasks, Obligations and Costs date filters count days where the company
 * is. They read "2026-01-15" as midnight UTC and ended it on the server's
 * clock, UTC too, so in Cairo "to 15 January" took in the first two hours of
 * the 16th, and "from 15 January" left out the first two of the 15th.
 */
describe("a date filter's days", () => {
    it("are the company's days, from their first moment to their last", () => {
        expect(dayRange("2026-01-15", "2026-01-15", "Africa/Cairo")).toEqual({
            gte: new Date("2026-01-14T22:00:00.000Z"),
            lte: new Date("2026-01-15T21:59:59.999Z"),
        })
        expect(dayRange("2026-01-01", "2026-01-31", "Asia/Dubai")).toEqual({
            gte: new Date("2025-12-31T20:00:00.000Z"),
            lte: new Date("2026-01-31T19:59:59.999Z"),
        })
    })

    it("leave out what was updated early the next day there, as UTC's didn't", () => {
        // 00:30 on the 16th in Cairo.
        const lateNight = new Date("2026-01-15T22:30:00.000Z")
        const { lte } = dayRange(null, "2026-01-15", "Africa/Cairo")!
        expect(lateNight > lte!).toBe(true)
        // What the filter used to end the day at.
        const old = new Date("2026-01-15")
        old.setUTCHours(23, 59, 59, 999)
        expect(lateNight <= old).toBe(true)
    })

    it("follow a day the clocks change on", () => {
        // Los Angeles springs forward on 8 March 2026: the day starts at -8 and ends at -7.
        expect(dayRange("2026-03-08", "2026-03-08", "America/Los_Angeles")).toEqual({
            gte: new Date("2026-03-08T08:00:00.000Z"),
            lte: new Date("2026-03-09T06:59:59.999Z"),
        })
    })

    it("start when the clocks jump, on a day they skip midnight", () => {
        // Havana goes from -5 to -4 at midnight on 8 March 2026: there's no
        // 00:00, and the day starts at 01:00, 05:00 UTC. The day before ends
        // just before it.
        expect(dayRange("2026-03-08", "2026-03-08", "America/Havana")).toEqual({
            gte: new Date("2026-03-08T05:00:00.000Z"),
            lte: new Date("2026-03-09T03:59:59.999Z"),
        })
        expect(dayRange(null, "2026-03-07", "America/Havana")).toEqual({ lte: new Date("2026-03-08T04:59:59.999Z") })
        // Santiago, from -4 to -3 on 6 September; Cairo, from +2 to +3 on 24 April.
        expect(dayRange("2026-09-06", null, "America/Santiago")).toEqual({ gte: new Date("2026-09-06T04:00:00.000Z") })
        expect(dayRange("2026-04-24", null, "Africa/Cairo")).toEqual({ gte: new Date("2026-04-23T22:00:00.000Z") })
    })

    it("start at the first midnight, on a day the clocks go back over it", () => {
        // Havana goes from -4 back to -5 at 01:00 on 1 November 2026, so its
        // midnight comes twice, at 04:00 and 05:00 UTC.
        expect(dayRange("2026-11-01", null, "America/Havana")).toEqual({ gte: new Date("2026-11-01T04:00:00.000Z") })
        expect(dayRange(null, "2026-10-31", "America/Havana")).toEqual({ lte: new Date("2026-11-01T03:59:59.999Z") })
    })

    it("leave an end open when it isn't a day, and are nothing when neither is", () => {
        expect(dayRange("2026-01-15", "", "Africa/Cairo")).toEqual({ gte: new Date("2026-01-14T22:00:00.000Z") })
        expect(dayRange(undefined, "2026-01-15", "Africa/Cairo")).toEqual({ lte: new Date("2026-01-15T21:59:59.999Z") })
        expect(dayRange("not a day", "2026-02-30", "Africa/Cairo")).toBeNull()
        expect(parseDay("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 })
        expect(parseDay("2026-2-28")).toBeNull()
    })

    it("are what the tasks list filters by", () => {
        const session = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) as any }
        const params = new URLSearchParams({ dateFrom: "2026-01-15", dateTo: "2026-01-15" })
        const result = buildTaskWhereClause(session, params, null, "Africa/Cairo")
        expect(result.empty).toBe(false)
        expect((result as any).whereClause.AND).toContainEqual({ updatedAt: { gte: new Date("2026-01-14T22:00:00.000Z"), lte: new Date("2026-01-15T21:59:59.999Z") } })
    })

    it("are counted in the company's zone on every list with a date filter", () => {
        const LISTS = [
            "app/api/obligations/route.ts",
            "app/(dashboard)/dashboard/obligations/page.tsx",
            "app/(dashboard)/dashboard/tasks/page.tsx",
            "lib/services/costs-query.ts",
            "lib/services/task-query.ts",
        ]
        for (const path of LISTS) {
            const source = readFileSync(path, "utf8")
            expect(source, path).not.toContain("setHours(23, 59, 59, 999)")
            expect(source, path).toMatch(/dayRange(In)?\(/)
        }
        expect(readFileSync("app/api/tasks/route.ts", "utf8")).toContain("await filterTimeZone(session.user.companyId ?? companyId)")
    })
})
