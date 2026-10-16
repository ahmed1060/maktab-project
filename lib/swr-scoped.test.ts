import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { forScope, scopedFetcher, scopedKey } from "./swr-scoped"

/**
 * Codex on #78: a list that keeps its rows while the next page loads kept
 * the last company's rows, still actionable, after a Super Admin picked
 * another company: until the new rows came, or for good if they didn't.
 */

afterEach(() => vi.unstubAllGlobals())

describe("a list's rows, kept within one company", () => {
    it("tells each response which company it's for", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { data: [{ id: "u1" }] } }), { status: 200 })))
        expect(scopedKey("/api/users?page=1", "c1")).toEqual(["/api/users?page=1", "c1"])
        expect(await scopedFetcher(["/api/users?page=1", "c1"])).toEqual({ scope: "c1", body: { data: { data: [{ id: "u1" }] } } })
        expect(fetch).toHaveBeenCalledWith("/api/users?page=1", { cache: "no-store" })
    })

    it("asks nothing without a question", () => {
        expect(scopedKey(null, "c1")).toBeNull()
    })

    it("keeps the rows for this company, from whichever page or filter", () => {
        const kept = { scope: "c1", body: { rows: 1 } }
        expect(forScope(kept, "c1")).toEqual({ rows: 1 })
    })

    it("drops another company's rows, so nothing on screen belongs to it", () => {
        expect(forScope({ scope: "c1", body: { rows: 1 } }, "c2")).toBeUndefined()
        // All companies, for a Super Admin who hasn't picked one, is a scope too.
        expect(forScope({ scope: "c1", body: { rows: 1 } }, null)).toBeUndefined()
        expect(forScope({ scope: "", body: { rows: 1 } }, undefined)).toEqual({ rows: 1 })
        expect(forScope(undefined, "c1")).toBeUndefined()
    })

    it("is how the Employees and Day Off lists keep their rows", () => {
        const employees = readFileSync("app/(dashboard)/dashboard/employees/page.tsx", "utf8")
        expect(employees).toContain("useSWR(scopedKey(listQuery ? employeesListUrl(listQuery) : null, selectedCompanyId), scopedFetcher, { keepPreviousData: true })")
        expect(employees).toContain("const result = forScope(scoped, selectedCompanyId)")
        const dayOff = readFileSync("app/(dashboard)/dashboard/day-off-requests/page.tsx", "utf8")
        expect(dayOff).toContain("useSWR(scopedKey(requestsQuery, contextCompanyId), scopedFetcher, { keepPreviousData: true })")
        expect(dayOff).toContain("const requestsResult = forScope(scopedRequests, contextCompanyId)")
        for (const page of [employees, dayOff]) expect(page).not.toMatch(/useSWR\([^)]*, fetcher, \{ keepPreviousData: true \}\)/)
    })

    // The same on the other pages a Super Admin switches company on. Payroll's
    // Approve and Mark as paid name the company picked, so the last company's
    // register must not be on screen when they're pressed.
    it("is how Requests, Requests history and Payroll keep theirs", () => {
        const requests = readFileSync("components/requests/RequestsSection.tsx", "utf8")
        expect(requests).toContain("useSWR(scopedKey(requestsUrl, selectedCompanyId), scopedFetcher, { keepPreviousData: true })")
        expect(requests).toContain("const result = forScope(scoped, selectedCompanyId)")
        const history = readFileSync("app/(dashboard)/dashboard/requests/history/RequestsHistoryClient.tsx", "utf8")
        expect(history).toContain("useSWR(scopedKey(historyUrl, selectedCompanyId), scopedFetcher, { keepPreviousData: true })")
        expect(history).toContain("const result = forScope(scoped, selectedCompanyId)")
        const payroll = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")
        expect(payroll).toContain("useSWR(scopedKey(registerKey, companyId), scopedFetcher, {")
        expect(payroll).toContain("const data = forScope(scoped, companyId)")
        for (const page of [requests, history, payroll]) expect(page).not.toMatch(/useSWR\((requestsUrl|historyUrl|registerKey), fetcher/)
    })
})
