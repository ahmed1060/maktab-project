import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ONLINE_WINDOW_MS, presenceWhere } from "@/lib/presence"
import { encodeGrants } from "@/lib/permissions/grants"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Status counts on All users (LATER_CHANGES_PLAN.md §6, PR 384): the list
 * answers the Super Admin, when asked, how many at work have each status, over
 * the company picked and every page, never the search or the status shown.
 * Online and Offline are counted as the list's own filter asks. The real
 * route runs; prisma is a fake that records what it's asked and answers by
 * what the question is.
 */

const NOW = new Date("2026-11-23T12:00:00Z")
const state = { session: null as any }
let finds: any[] = []
let counts: any[] = []
/** People online, as the fake finds them: one 30 seconds ago, one 4 minutes ago. */
const ONLINE = [
    { status: "ACTIVE", openTabs: [{ seenAt: new Date(NOW.getTime() - 30_000) }] },
    { status: "ACTIVE", openTabs: [{ seenAt: new Date(NOW.getTime() - 4 * 60_000) }] },
]
const PAGE = [{ id: "u1", firstName: "Made", lastName: "Up", email: "made.up@example.com", status: "OFFLINE", role: "EMPLOYEE", openTabs: [], company: { id: "c1", name: "Delta Sites" } }]
const text = (x: unknown) => JSON.stringify(x)
const asksOnline = (where: unknown) => text(where).includes('"openTabs":{"some"')
const asksOffline = (where: unknown) => text(where).includes('"openTabs":{"none"')

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/sign-in-lock", () => ({ lockedUntil: async () => new Map() }))
vi.mock("@/lib/own-password", () => ({ ownPasswordPausedUntil: async () => new Map(), CURRENT_PASSWORD_WRONG: "x", OWN_PASSWORD_TRIES: "y", OWN_PASSWORD_WRONG: "z" }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findMany: async (args: any) => {
                finds.push(args.where)
                return asksOnline(args.where) && args.select?.openTabs && !args.take ? ONLINE : PAGE
            },
            count: async (args: any) => {
                counts.push(args.where)
                const w = text(args.where)
                if (asksOffline(args.where)) return 5
                if (w.includes('"status":"SUSPENDED"')) return 1
                if (w.includes('"status":"ARCHIVED"')) return 0
                return PAGE.length
            },
        },
        company: { findUnique: async () => null },
        rateLimit: { findUnique: async () => null, upsert: async () => ({ count: 1 }), update: async () => ({ count: 1 }) },
    },
}))

const superAdmin = { id: "sa1", role: "SUPER_ADMIN", companyId: null }
const admin = { id: "a1", role: "ADMIN", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY" }) }
const list = async (query: string) => {
    const res = await (await import("@/app/api/users/route")).GET(new Request(`https://nizmo.test/api/users?${query}`), { params: {} })
    return { status: res.status, body: await res.json() }
}
/** The where clauses the counts asked: every query but the list's own, its rows and its total. */
const countWheres = () => [...counts.filter(w => text(w) !== text(finds[0])), ...finds.slice(1)]

beforeEach(() => {
    finds = []
    counts = []
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

describe("the counts", () => {
    it("say how many at work have each status, for the Super Admin, when asked", async () => {
        state.session = { user: superAdmin }
        const { status, body } = await list("page=1&limit=10&companyId=c1&search=&counts=status")
        expect(status).toBe(200)
        expect(body.data.statusCounts).toEqual({ ACTIVE: 2, OFFLINE: 5, SUSPENDED: 1, ARCHIVED: 0 })
    })

    it("count the company picked, at work, never the search or the status shown", async () => {
        state.session = { user: superAdmin }
        await list("page=1&limit=10&companyId=c1&search=youssef&status=SUSPENDED&counts=status")
        const asked = countWheres()
        expect(asked).toHaveLength(4)
        for (const where of asked) {
            const w = text(where)
            expect(w).toContain('"companyId":"c1"')
            expect(w).toContain('"status":{"not":"DELETED"}')
            expect(w).not.toContain("youssef")
        }
        // The list itself still asks for the search and the status shown.
        expect(text(finds[0])).toContain("youssef")
        expect(text(finds[0])).toContain('"status":"SUSPENDED"')
    })

    it("count every company with none picked", async () => {
        state.session = { user: superAdmin }
        await list("page=1&limit=10&companyId=&search=&counts=status")
        expect(countWheres()).toHaveLength(4)
        for (const where of countWheres()) expect(text(where)).not.toContain('"companyId"')
    })

    it("count Online and Offline as the list's own status filter asks", async () => {
        state.session = { user: superAdmin }
        await list("page=1&limit=10&companyId=c1&search=&counts=status")
        const asked = countWheres().map(w => text(w))
        expect(asked.some(w => w.includes(text(presenceWhere("ACTIVE", NOW))))).toBe(true)
        expect(asked.some(w => w.includes(text(presenceWhere("OFFLINE", NOW))))).toBe(true)
    })

    it("run out with the first person counted online, not only those on the page shown", async () => {
        state.session = { user: superAdmin }
        const { body } = await list("page=1&limit=10&companyId=&search=&counts=status")
        expect(body.data.onlineRunsOutInMs).toBe(ONLINE_WINDOW_MS - 4 * 60_000 + 1)
    })
})

describe("no counts", () => {
    it("unless asked", async () => {
        state.session = { user: superAdmin }
        const { body } = await list("page=1&limit=10&companyId=&search=")
        expect(body.data).not.toHaveProperty("statusCounts")
        expect(countWheres()).toEqual([])
    })

    it("for anyone but the Super Admin", async () => {
        state.session = { user: admin }
        const { status, body } = await list("page=1&limit=10&search=&counts=status")
        expect(status).toBe(200)
        expect(body.data).not.toHaveProperty("statusCounts")
        expect(countWheres()).toEqual([])
    })

    it("on the Left tab, where everyone has the same status", async () => {
        state.session = { user: superAdmin }
        const { body } = await list("page=1&limit=10&status=DELETED&companyId=&search=&counts=status")
        expect(body.data).not.toHaveProperty("statusCounts")
        expect(countWheres()).toEqual([])
    })
})
