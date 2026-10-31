import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { forScope, loadFailed, scopedFetcher, scopedKey } from "./swr-scoped"

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
        expect(await scopedFetcher(["/api/users?page=1", "c1"])).toEqual({ scope: "c1", url: "/api/users?page=1", body: { data: { data: [{ id: "u1" }] } } })
        expect(fetch).toHaveBeenCalledWith("/api/users?page=1", { cache: "no-store" })
    })

    it("asks nothing without a question", () => {
        expect(scopedKey(null, "c1")).toBeNull()
    })

    it("keeps the rows for this company, from whichever page or filter", () => {
        const kept = { scope: "c1", url: "/api/users?page=1", body: { rows: 1 } }
        expect(forScope(kept, "c1")).toEqual({ rows: 1 })
    })

    it("drops another company's rows, so nothing on screen belongs to it", () => {
        expect(forScope({ scope: "c1", url: "/a", body: { rows: 1 } }, "c2")).toBeUndefined()
        // All companies, for a Super Admin who hasn't picked one, is a scope too.
        expect(forScope({ scope: "c1", url: "/a", body: { rows: 1 } }, null)).toBeUndefined()
        expect(forScope({ scope: "", url: "/a", body: { rows: 1 } }, undefined)).toEqual({ rows: 1 })
        expect(forScope(undefined, "c1")).toBeUndefined()
    })

    // The product owner's request: a list that didn't load says so (DESIGN.md
    // §5.5), rather than "No employees found" and an offer to add one.
    it("knows when the list didn't load, as against a refresh of rows on screen failing", () => {
        const page1 = { scope: "c1", url: "/api/users?page=1", body: { rows: 1 } }
        // Page 2 failed, and page 1's rows are what's kept: that's a failure.
        expect(loadFailed(page1, new Error("500"), "/api/users?page=2")).toBe(true)
        // Nothing loaded at all.
        expect(loadFailed(undefined, new Error("500"), "/api/users?page=1")).toBe(true)
        // Page 1 is on screen and only its refresh failed: its rows stay.
        expect(loadFailed(page1, new Error("500"), "/api/users?page=1")).toBe(false)
        // No error, or no question asked.
        expect(loadFailed(undefined, undefined, "/api/users?page=1")).toBe(false)
        expect(loadFailed(undefined, new Error("500"), null)).toBe(false)
    })

    it("is how the lists say they didn't load, with Try again", () => {
        const employees = readFileSync("app/(dashboard)/dashboard/employees/page.tsx", "utf8")
        expect(employees).toContain("const failed = loadFailed(scoped, error, listUrl)")
        expect(employees).toContain("if (isLoading && !result && !failed) return <LoadingSpinner")
        expect(employees).toContain("<EmptyState icon={WarningCircleIcon} title={t('employees_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />")
        expect(readFileSync("components/EmployeeFilter.tsx", "utf8")).toContain("{totalCount !== undefined && <div style={{")
    })

    // Day off's list is the Requests page's since UI_PLAN.md §2.3, part 2d, read on the server below.
    it("is how the Employees list keeps its rows", () => {
        const employees = readFileSync("app/(dashboard)/dashboard/employees/page.tsx", "utf8")
        expect(employees).toContain("const listUrl = listQuery ? employeesListUrl(listQuery) : null")
        expect(employees).toContain("useSWR(scopedKey(listUrl, selectedCompanyId), scopedFetcher, { keepPreviousData: true })")
        expect(employees).toContain("const result = forScope(scoped, selectedCompanyId)")
        expect(employees).not.toMatch(/useSWR\([^)]*, fetcher, \{ keepPreviousData: true \}\)/)
    })

    // The Requests page is read on the server now (UI_PLAN.md §2.3): the
    // Super Admin's company is in its address, so a page for another
    // company is never kept, and only the Super Admin's reach moves with it.
    it("is how the Requests page follows the Super Admin's company", () => {
        const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
        expect(client).toContain("go({ companyId: selectedCompanyId ?? '' })")
        const server = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")
        expect(server).toContain("companyId: superAdmin ? searchParams.companyId || null : null")
    })
})
