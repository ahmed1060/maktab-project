import { describe, it, expect, vi } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The Costs page's Employee costs tab on a page past its last, as when the
 * last task on page 3 is paid elsewhere and the page is refreshed, or a link
 * from before: it goes to the last page there is now. Its pager is in the
 * list's footer, and an empty list shows only its empty state, so on such a
 * page there was no way back to the costs still to pay, and it said there
 * were none (found by Codex on PR 117).
 */

const state = { count: 0 }

vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: withGrants({ id: "admin", role: "ADMIN", companyId: "c1" }) }) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
vi.mock("@/app/(dashboard)/dashboard/costs/CostsClient", () => ({ default: () => null }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: { findUnique: async () => null },
        task: { findMany: async () => [], count: async () => state.count },
        taskCost: { groupBy: async () => [] },
    },
}))

async function open(query: Record<string, string>, count: number) {
    state.count = count
    const { default: CostsPage } = await import("@/app/(dashboard)/dashboard/costs/page")
    return CostsPage({ searchParams: Promise.resolve(query) }).then(() => "shown", (e: Error) => e.message)
}

describe("the Employee costs tab on a page that isn't there", () => {
    it("goes to the last page there is, with the same filters", async () => {
        // 12 to pay is two pages of ten.
        expect(await open({ page: "3", employeeId: "u1", search: "gate" }, 12)).toBe("REDIRECT /dashboard/costs?page=2&employeeId=u1&search=gate")
    })

    it("goes to the first from a page that's no page at all", async () => {
        expect(await open({ page: "0" }, 12)).toBe("REDIRECT /dashboard/costs?page=1")
        expect(await open({ page: "x" }, 12)).toBe("REDIRECT /dashboard/costs?page=1")
    })

    it("stays on a page that's there, and on the first when there's nothing", async () => {
        expect(await open({ page: "2" }, 12)).toBe("shown")
        expect(await open({ page: "1" }, 0)).toBe("shown")
        expect(await open({}, 12)).toBe("shown")
    })
})
