import { describe, it, expect, vi } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The Obligations list on a page past its last goes to the last there is,
 * as the Tasks list does (lib/tasks-page-range.test.ts). It sends what each
 * row shows, and the time an obligation is judged overdue by.
 */

const state = { count: 0, args: null as any, props: null as any }

vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: withGrants({ id: "admin", role: "ADMIN", companyId: "c1" }) }) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
vi.mock("@/app/(dashboard)/dashboard/obligations/ObligationsClient", () => ({ default: () => null }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: { findUnique: async () => null },
        obligation: { findMany: async (args: any) => { state.args = args; return [] }, count: async () => state.count },
    },
}))

async function open(query: Record<string, string>, count: number) {
    state.count = count
    const { default: ObligationsPage } = await import("@/app/(dashboard)/dashboard/obligations/page")
    return ObligationsPage({ searchParams: Promise.resolve(query) }).then((el: any) => { state.props = el?.props; return "shown" }, (e: Error) => e.message)
}

describe("the Obligations list on a page that isn't there", () => {
    it("goes to the last page there is, with the same filters", async () => {
        expect(await open({ page: "3", status: "PENDING" }, 12)).toBe("REDIRECT /dashboard/obligations?page=2&status=PENDING")
    })

    it("goes to the first from a page that's no page at all, and stays on one that's there", async () => {
        expect(await open({ page: "0" }, 12)).toBe("REDIRECT /dashboard/obligations?page=1")
        expect(await open({ page: "2" }, 12)).toBe("shown")
        expect(await open({}, 0)).toBe("shown")
    })
})

describe("what the Obligations list is sent", () => {
    it("has each one's assignees with their ids, and the time it's judged overdue by", async () => {
        expect(await open({}, 1)).toBe("shown")
        expect(state.args.select.assignees).toEqual({ select: { id: true, firstName: true, lastName: true } })
        expect(state.args.select.recurrence).toBe(true)
        expect(typeof state.props.now).toBe("number")
        expect(state.props.currentUserId).toBe("admin")
    })
})
