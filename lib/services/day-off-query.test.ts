import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dayOffListFilters } from "./day-off-query"

/**
 * The day-off lists are paged, so their filters have to be the server's. The
 * screen used to filter the ten requests it had been sent: "Pending" showed
 * page one's pending requests while the count and the pages still went
 * through every request.
 */

const filters = (qs: string) => dayOffListFilters(new URLSearchParams(qs))

describe("a day-off list's filters", () => {
    it("narrow by status, and a status that doesn't exist matches nothing", () => {
        expect(filters("status=PENDING")).toEqual([{ status: "PENDING" }])
        expect(filters("status=LOST")).toEqual([{ id: "__no_match__" }])
    })

    it("narrow to one employee", () => {
        expect(filters("userId=u1")).toEqual([{ userId: "u1" }])
    })

    it("keep requests that start inside the days picked, both days included", () => {
        expect(filters("from=2026-10-01&to=2026-10-31")).toEqual([{
            date: { gte: new Date("2026-10-01T00:00:00.000Z"), lt: new Date("2026-11-01T00:00:00.000Z") },
        }])
        expect(filters("from=2026-10-01")).toEqual([{ date: { gte: new Date("2026-10-01T00:00:00.000Z") } }])
        // Not a day: ignored rather than sent to the database.
        expect(filters("from=yesterday&to=2026-13-45x")).toEqual([])
    })

    it("search the reason, whatever the case", () => {
        expect(filters("search=%20doctor%20")).toEqual([{ reason: { contains: "doctor", mode: "insensitive" } }])
        expect(filters("search=%20%20")).toEqual([])
    })

    it("add nothing when nothing is picked", () => {
        expect(filters("page=2&limit=10&companyId=c1")).toEqual([])
    })
})

describe("both lists use them, inside their own scope", () => {
    it("the manager's list adds them beside the scope", () => {
        const route = readFileSync("app/api/admin/day-off-requests/route.ts", "utf8")
        expect(route).toContain("const filters = dayOffListFilters(searchParams)")
        expect(route).toContain("if (filters.length > 0) where.AND = filters")
        // Added after the scope is set, which they can't replace: the scope is
        // `where.user`, the filters are `where.AND`.
        expect(route.indexOf("where.AND = filters")).toBeGreaterThan(route.lastIndexOf("where.user ="))
    })

    it("someone's own list keeps them to their own requests", () => {
        expect(readFileSync("app/api/day-off-requests/route.ts", "utf8")).toContain("DayOffService.getMany(session.user.id, skip, limit, dayOffListFilters(searchParams))")
        expect(readFileSync("lib/services/day-off.service.ts", "utf8")).toContain("const where = filters.length > 0 ? { userId, AND: filters } : { userId }")
    })
})
