import { describe, it, expect, vi, beforeEach } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * A Team Leader's obligations (LATER_CHANGES_PLAN.md §7.16; DESIGN.md §5.5,
 * A Team Leader's obligations): the Obligations list has My obligations and
 * My team's obligations for whoever sees the team's, as Tasks has. The rule
 * is the page's, so an address asking for the team's tab from anyone else
 * changes nothing. Made-up people.
 */

const state = {
    user: null as any,
    where: null as any,
    props: null as any,
    // The obligation a notification opened, as the page looks it up.
    teamOnly: new Set<string>(),
    lookups: [] as any[],
}

vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: state.user }) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
vi.mock("@/app/(dashboard)/dashboard/obligations/ObligationsClient", () => ({ default: () => null }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: { findUnique: async () => null },
        obligation: {
            findMany: async (args: any) => { state.where = args.where; return [] },
            count: async (args: any) => {
                // The list's own count has the list's where; the notification's
                // lookup asks for one obligation by its id.
                if (args?.where?.id) {
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
    const { default: ObligationsPage } = await import("@/app/(dashboard)/dashboard/obligations/page")
    const el: any = await ObligationsPage({ searchParams: Promise.resolve(query) })
    state.props = el?.props
    return { where: JSON.stringify(state.where), view: state.props?.view }
}

const OWN = (id: string) => `{"assignees":{"some":{"id":"${id}"}}}`
const REPORTS = (id: string) => `{"assignees":{"some":{"teamLeaderId":"${id}"}}}`

beforeEach(() => { state.teamOnly.clear(); state.lookups = [] })

describe("a Team Leader's Obligations list", () => {
    it("opens on My obligations: the ones assigned to them", async () => {
        const { where, view } = await open(leader())
        expect(view).toBe("my")
        expect(where).toContain(OWN("tl"))
        expect(where).not.toContain(REPORTS("tl"))
    })

    it("My team's obligations: the ones assigned to someone on their team", async () => {
        const { where, view } = await open(leader(), { view: "active" })
        expect(view).toBe("active")
        expect(where).toContain(REPORTS("tl"))
        expect(where).not.toContain(OWN("tl"))
        expect(where).toContain('"companyId":"c1"')
    })

    it("an address asking for anything else is My obligations", async () => {
        expect((await open(leader(), { view: "everyone" })).view).toBe("my")
        expect((await open(leader(), { view: "everyone" })).where).toContain(OWN("tl"))
    })

    it("keeps the filters picked on either tab, inside the tab's own", async () => {
        const { where } = await open(leader(), { view: "active", status: "PENDING", employeeId: "u9" })
        expect(where).toContain(REPORTS("tl"))
        expect(where).toContain('"status":"PENDING"')
        expect(where).toContain(OWN("u9"))
    })
})

describe("a notification's obligation", () => {
    it("one of the team's, not their own, opens the team's tab", async () => {
        state.teamOnly.add("o-team")
        const { view, where } = await open(leader(), { highlight: "o-team" })
        expect(view).toBe("active")
        expect(where).toContain(REPORTS("tl"))
        // Looked up within the company and the team, and not their own.
        expect(JSON.stringify(state.lookups[0])).toContain('"companyId":"c1"')
        expect(JSON.stringify(state.lookups[0])).toContain(REPORTS("tl"))
        expect(JSON.stringify(state.lookups[0])).toContain(`"NOT":${OWN("tl")}`)
    })

    it("their own opens My obligations", async () => {
        expect((await open(leader(), { highlight: "o-mine" })).view).toBe("my")
    })

    it("a tab asked for is the tab shown, and nobody else's is looked up", async () => {
        state.teamOnly.add("o-team")
        expect((await open(leader(), { highlight: "o-team", view: "my" })).view).toBe("my")
        expect(state.lookups).toEqual([])
        expect((await open(admin(), { highlight: "o-team" })).view).not.toBe("active")
        expect((await open(employee(), { highlight: "o-team" })).view).toBe("my")
        expect(state.lookups).toEqual([])
    })
})

describe("everyone else's list is as it was", () => {
    it("an employee asking for the team's tab sees their own", async () => {
        const { where, view } = await open(employee(), { view: "active" })
        expect(view).toBe("my")
        expect(where).toContain(OWN("e1"))
        expect(where).not.toContain("teamLeaderId")
    })

    it("an Admin sees the company's, whatever tab is asked for", async () => {
        for (const query of [{}, { view: "my" }, { view: "active" }] as Record<string, string>[]) {
            const { where } = await open(admin(), query)
            expect(where).toBe('{"companyId":"c1"}')
        }
    })
})
