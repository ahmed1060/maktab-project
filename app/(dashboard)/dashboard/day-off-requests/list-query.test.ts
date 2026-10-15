import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dayOffListUrl } from "./list-query"

const base = { page: 1, limit: 10 }
const parse = (url: string) => new URL(url, "http://x")

describe("the day-off list asks the server for its filters", () => {
    it("a manager's, with the employee picked", () => {
        const u = parse(dayOffListUrl({ ...base, manages: true, companyId: "c1", status: "PENDING", employeeId: "u1", from: "2026-10-01", to: "2026-10-31", search: " doctor " }))
        expect(u.pathname).toBe("/api/admin/day-off-requests")
        expect(Object.fromEntries(u.searchParams)).toEqual({
            companyId: "c1", page: "1", limit: "10", status: "PENDING", userId: "u1", from: "2026-10-01", to: "2026-10-31", search: "doctor",
        })
    })

    it("someone's own, which never names another employee or company", () => {
        const u = parse(dayOffListUrl({ ...base, manages: false, companyId: "c1", employeeId: "u1", status: "APPROVED" }))
        expect(u.pathname).toBe("/api/day-off-requests")
        expect(u.searchParams.has("userId")).toBe(false)
        expect(u.searchParams.has("companyId")).toBe(false)
        expect(u.searchParams.get("status")).toBe("APPROVED")
    })
})

describe("the Day Off Requests page", () => {
    it("doesn't filter in the browser", () => {
        const page = readFileSync("app/(dashboard)/dashboard/day-off-requests/page.tsx", "utf8")
        expect(page).toContain("dayOffListUrl({")
        expect(page).not.toMatch(/requests\.filter\(req =>/)
    })
})
