import { describe, it, expect, vi, beforeEach } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * A Team Leader's task notifications (LATER_CHANGES_PLAN.md §7.17; DESIGN.md
 * §5.5, A Team Leader's task notifications): a notification's link carries
 * its task (`?highlight=`), and the Tasks list opens on the tab it's on, as
 * Obligations does (lib/obligations-team-tabs.test.ts). One of the team's,
 * not their own, is on My team's tasks; their own is on My tasks. Made-up
 * people.
 */

const state = {
    user: null as any,
    where: null as any,
    props: null as any,
    // The tasks a notification may open that are the team's and not the leader's own.
    teamOnly: new Set<string>(),
    lookups: [] as any[],
}

vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: state.user }) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
vi.mock("@/app/(dashboard)/dashboard/tasks/TasksClient", () => ({ default: () => null }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: { findUnique: async () => null },
        task: {
            findMany: async (args: any) => { state.where = args.where; return [] },
            count: async (args: any) => {
                // The list's own count has the list's where; the notification's
                // lookup asks for one task by its id, even one sent without it.
                if (args?.where && Object.prototype.hasOwnProperty.call(args.where, "id")) {
                    state.lookups.push(args.where)
                    return state.teamOnly.has(args.where.id) ? 1 : 0
                }
                return 0
            },
        },
    },
}))

const leader = () => withGrants({ id: "tl", role: "TEAM_LEADER", companyId: "c1" })
const employee = () => withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
const admin = () => withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })

async function open(user: any, query: Record<string, string> = {}) {
    state.user = user
    const { default: TasksPage } = await import("@/app/(dashboard)/dashboard/tasks/page")
    const el: any = await TasksPage({ searchParams: Promise.resolve(query) })
    state.props = el?.props
    return { where: JSON.stringify(state.where), view: state.props?.view }
}

const OWN = (id: string) => `{"assignees":{"some":{"id":"${id}"}}}`
const REPORTS = (id: string) => `{"assignees":{"some":{"teamLeaderId":"${id}"}}}`

beforeEach(() => { state.teamOnly.clear(); state.lookups = [] })

describe("a notification's task, for a Team Leader", () => {
    it("one of the team's, not their own, opens My team's tasks", async () => {
        state.teamOnly.add("t-team")
        const { view, where } = await open(leader(), { highlight: "t-team" })
        expect(view).toBe("active")
        expect(where).toContain(REPORTS("tl"))
        expect(where).not.toContain(OWN("tl"))
    })

    it("is looked up within their company and their team, and not their own", async () => {
        state.teamOnly.add("t-team")
        await open(leader(), { highlight: "t-team" })
        expect(state.lookups).toHaveLength(1)
        const lookup = JSON.stringify(state.lookups[0])
        expect(state.lookups[0].id).toBe("t-team")
        expect(lookup).toContain('"companyId":"c1"')
        expect(lookup).toContain(REPORTS("tl"))
        expect(lookup).toContain(`"NOT":${OWN("tl")}`)
    })

    it("their own, or one shared with them, opens My tasks", async () => {
        const { view, where } = await open(leader(), { highlight: "t-mine" })
        expect(view).toBe("my")
        expect(where).toContain(OWN("tl"))
    })

    it("a tab asked for is the tab shown, and nothing is looked up", async () => {
        state.teamOnly.add("t-team")
        expect((await open(leader(), { highlight: "t-team", view: "my" })).view).toBe("my")
        expect((await open(leader(), { highlight: "t-team", view: "team" })).view).toBe("team")
        expect(state.lookups).toEqual([])
    })

    it("with no company, nothing is looked up", async () => {
        state.teamOnly.add("t-team")
        await open(withGrants({ id: "tl", role: "TEAM_LEADER", companyId: null }), { highlight: "t-team" })
        expect(state.lookups).toEqual([])
    })

    it("without a notification, the list opens on My tasks as before", async () => {
        const { view, where } = await open(leader())
        expect(view).toBe("my")
        expect(where).toContain(OWN("tl"))
        expect(state.lookups).toEqual([])
    })
})

describe("everyone else's list is as it was", () => {
    it("an employee's notification opens their own tasks, with nothing looked up", async () => {
        state.teamOnly.add("t-team")
        const { view, where } = await open(employee(), { highlight: "t-team" })
        expect(view).toBe("my")
        expect(where).toContain(OWN("e1"))
        expect(state.lookups).toEqual([])
    })

    it("an Admin's opens the company's, with nothing looked up", async () => {
        state.teamOnly.add("t-team")
        const { view, where } = await open(admin(), { highlight: "t-team" })
        expect(view).toBe("active")
        expect(where).toBe('{"companyId":"c1"}')
        expect(state.lookups).toEqual([])
    })
})
