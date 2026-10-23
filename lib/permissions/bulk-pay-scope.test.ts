import { describe, it, expect, vi, beforeEach } from "vitest"
import { withGrants, stepUpConfirmed } from "./test-actors"

/**
 * Which tasks bulk "mark paid" reaches.
 *
 * Recorded for Part B: a Team Leader holds tasks.pay for their team, and every
 * single-task payment route holds them to it, but the bulk route filtered by
 * company only — so a leader could pay any task in the company. Now it narrows
 * a team-scoped payer to tasks with someone on their team, on every path: by
 * filter, by ids, and inside the service that writes.
 *
 * A Super Admin's Costs page lists the company they chose, but the route had
 * no company in its query for them, so Mark all as paid paid every company's
 * costs. The page and the route now share one query (lib/services/costs-query.ts).
 *
 * Each query the route and service make is applied to the fixture tasks below,
 * so what is asserted is which tasks, not how the query is spelled.
 */

type Person = { id: string; companyId: string; teamLeaderId: string | null }
const P: Record<string, Person> = {
    tl:     { id: "tl",     companyId: "c1", teamLeaderId: null },
    emp:    { id: "emp",    companyId: "c1", teamLeaderId: "tl" },
    loner:  { id: "loner",  companyId: "c1", teamLeaderId: null },
    other:  { id: "other",  companyId: "c2", teamLeaderId: null },
}
const TASKS = [
    { id: "t-team",  companyId: "c1", assignees: [P.emp] },     // the leader's team
    { id: "t-own",   companyId: "c1", assignees: [P.tl] },      // the leader's own
    { id: "t-loner", companyId: "c1", assignees: [P.loner] },   // someone outside the team
    { id: "t-c2",    companyId: "c2", assignees: [P.other] },   // another company
].map(t => ({ ...t, status: "APPROVED", totalCost: 10, paymentStatus: "PENDING_PAYMENT", memberCosts: {} }))

/** Enough of Prisma's where on Task and User for these queries; throws on anything else. */
function matches(row: any, where: any): boolean {
    for (const [key, value] of Object.entries<any>(where ?? {})) {
        if (key === "AND") { if (!value.every((w: any) => matches(row, w))) return false; continue }
        if (key === "OR") { if (!value.some((w: any) => matches(row, w))) return false; continue }
        if (key === "assignees") { if (!row.assignees.some((a: any) => matches(a, value.some))) return false; continue }
        if (value !== null && typeof value === "object") {
            if ("in" in value) { if (!value.in.includes(row[key])) return false; continue }
            if ("gt" in value) { if (!(row[key] > value.gt)) return false; continue }
            if ("gte" in value || "lte" in value) continue
            if ("contains" in value) continue
            throw new Error(`unsupported: ${key} ${JSON.stringify(value)}`)
        }
        if (row[key] !== value) return false
    }
    return true
}

const seen = { paid: [] as string[] }
const findMany = async ({ where }: any) => TASKS.filter(t => matches(t, where)).map(t => ({ id: t.id, memberCosts: {} }))
const state = { session: null as any }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))
vi.mock("@/lib/prisma", () => {
    const tx: any = {
        task: {
            findMany,
            update: async ({ where }: any) => { seen.paid.push(where.id); return {} },
            updateMany: async ({ where }: any) => { seen.paid.push(...(where.id?.in ?? [])); return { count: 0 } },
        },
        auditLog: { create: async () => ({}) },
    }
    // No settings row: step-up (§6.15) uses its default interval.
    const COMPANIES = [{ id: "c1", name: "Acme" }, { id: "c2", name: "Delta" }]
    const company = { findUnique: async ({ where }: any) => COMPANIES.find(c => c.name === where.name) ?? null }
    return { prisma: { ...tx, company, rateLimit: { upsert: async () => ({ count: 1 }) }, systemSettings: { findUnique: async () => null }, $transaction: async (fn: any) => fn(tx) } }
})

const ACTORS = {
    admin:  withGrants({ id: "admin", role: "ADMIN", companyId: "c1" }),
    leader: withGrants({ id: "tl", role: "TEAM_LEADER", companyId: "c1" }),
    superAdmin: withGrants({ id: "sa", role: "SUPER_ADMIN", companyId: null }),
}

async function pay(actor: keyof typeof ACTORS, body: object) {
    state.session = { user: stepUpConfirmed(ACTORS[actor]) }
    seen.paid = []
    const { POST } = await import("@/app/api/tasks/payment/bulk/route")
    await POST(new Request("https://nizmo.test/api/tasks/payment/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))
    return [...new Set(seen.paid)].sort()
}

const EVERY_ID = { taskIds: TASKS.map(t => t.id) }

beforeEach(() => { seen.paid = [] })

describe("bulk mark paid reaches the payer's scope", () => {
    it("an Admin: every task in their company", async () => {
        expect(await pay("admin", EVERY_ID)).toEqual(["t-loner", "t-own", "t-team"])
    })

    it("a Team Leader, by ids: their team's and their own, not the rest of the company", async () => {
        expect(await pay("leader", EVERY_ID)).toEqual(["t-own", "t-team"])
    })

    it("a Team Leader, by filter: the same", async () => {
        expect(await pay("leader", { filters: {} })).toEqual(["t-own", "t-team"])
    })

    it("a Team Leader, by filter for one employee outside the team: nothing", async () => {
        expect(await pay("leader", { filters: { employeeId: "loner" } })).toEqual([])
    })
})

describe("a Super Admin's Mark all as paid pays the company the Costs page shows", () => {
    it("with a company chosen: that company's costs only", async () => {
        expect(await pay("superAdmin", { filters: { company: "Delta" } })).toEqual(["t-c2"])
    })

    it("with none chosen: every company's, as the page lists them", async () => {
        expect(await pay("superAdmin", { filters: {} })).toEqual(["t-c2", "t-loner", "t-own", "t-team"])
    })

    it("with a name that matches no company: nothing, not every company", async () => {
        expect(await pay("superAdmin", { filters: { company: "Renamed" } })).toEqual([])
    })

    it("an Admin's company stays their own, whatever company the filters name", async () => {
        expect(await pay("admin", { filters: { company: "Delta" } })).toEqual(["t-loner", "t-own", "t-team"])
    })
})
