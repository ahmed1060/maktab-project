import { describe, it, expect, vi } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The Tasks list on a page past its last, as when its last task is deleted
 * and the page is refreshed: it goes to the last page there is now, as the
 * Employee costs tab does (lib/costs-page-range.test.ts). Its pager is in
 * the list's footer, and an empty list shows only its empty state.
 *
 * It sends each task's client and location for the line under its title.
 */

const state = { count: 0, args: null as any, props: null as any }

vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: withGrants({ id: "admin", role: "ADMIN", companyId: "c1" }) }) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
vi.mock("@/app/(dashboard)/dashboard/tasks/TasksClient", () => ({ default: () => null }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: { findUnique: async () => null },
        task: { findMany: async (args: any) => { state.args = args; return [] }, count: async () => state.count },
    },
}))

async function open(query: Record<string, string>, count: number) {
    state.count = count
    const { default: TasksPage } = await import("@/app/(dashboard)/dashboard/tasks/page")
    return TasksPage({ searchParams: Promise.resolve(query) }).then((el: any) => { state.props = el?.props; return "shown" }, (e: Error) => e.message)
}

describe("the Tasks list on a page that isn't there", () => {
    it("goes to the last page there is, with the same filters", async () => {
        // 12 tasks is two pages of ten.
        expect(await open({ page: "3", status: "PENDING", search: "gate" }, 12)).toBe("REDIRECT /dashboard/tasks?page=2&status=PENDING&search=gate")
    })

    it("goes to the first from a page that's no page at all", async () => {
        expect(await open({ page: "0" }, 12)).toBe("REDIRECT /dashboard/tasks?page=1")
        expect(await open({ page: "x" }, 12)).toBe("REDIRECT /dashboard/tasks?page=1")
    })

    it("stays on a page that's there, and on the first when there's nothing", async () => {
        expect(await open({ page: "2" }, 12)).toBe("shown")
        expect(await open({ page: "1" }, 0)).toBe("shown")
        expect(await open({}, 12)).toBe("shown")
    })
})

describe("what the Tasks list is sent", () => {
    it("has each task's client and location, and the time it's judged overdue by", async () => {
        expect(await open({}, 1)).toBe("shown")
        expect(state.args.select.client).toEqual({ select: { name: true } })
        expect(state.args.select.place).toEqual({ select: { name: true, client: { select: { name: true } } } })
        expect(typeof state.props.now).toBe("number")
    })
})
