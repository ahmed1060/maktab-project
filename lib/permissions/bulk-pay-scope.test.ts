import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Prisma } from "@prisma/client"
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
 * With one employee picked, the page lists that employee's shares of each
 * task's cost, and the button paid every task whole, the other members'
 * shares too. It now pays that employee's shares only.
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
type Task = {
    id: string; companyId: string; assignees: Person[]; status: string; totalCost: number; paymentStatus: string
    memberCosts: Record<string, number>; memberPaymentStatus: Record<string, string>
    clientId: string | null; locationId: string | null
}
// Each with its client, or none, and its location (CLIENTS_PLAN.md §3).
const TASKS: Task[] = ([
    { id: "t-team",  companyId: "c1", assignees: [P.emp],   memberCosts: { emp: 10 },   clientId: "acme", locationId: "acme-hq" },   // the leader's team
    { id: "t-own",   companyId: "c1", assignees: [P.tl],    memberCosts: { tl: 10 },    clientId: null,   locationId: "port" },      // the leader's own
    { id: "t-loner", companyId: "c1", assignees: [P.loner], memberCosts: { loner: 10 }, clientId: "acme", locationId: "acme-site" }, // someone outside the team
    { id: "t-c2",    companyId: "c2", assignees: [P.other], memberCosts: { other: 10 }, clientId: "far",  locationId: "far-hq" },    // another company
] as Pick<Task, "id" | "companyId" | "assignees" | "memberCosts" | "clientId" | "locationId">[]).map(t => ({ ...t, status: "APPROVED", totalCost: 10, paymentStatus: "PENDING_PAYMENT", memberPaymentStatus: {} }))
// Shared by the leader's team and someone outside it, each with a share.
const SHARED: Task = { id: "t-shared", companyId: "c1", assignees: [P.emp, P.loner], memberCosts: { emp: 100, loner: 50 }, status: "APPROVED", totalCost: 150, paymentStatus: "PENDING_PAYMENT", memberPaymentStatus: {}, clientId: "acme", locationId: "acme-hq" }
const fixture = { tasks: TASKS }

/** Enough of Prisma's where on Task and User for these queries; throws on anything else. */
function matches(row: any, where: any): boolean {
    for (const [key, value] of Object.entries<any>(where ?? {})) {
        if (key === "AND") { if (!value.every((w: any) => matches(row, w))) return false; continue }
        if (key === "OR") { if (!value.some((w: any) => matches(row, w))) return false; continue }
        if (key === "assignees") { if (!row.assignees.some((a: any) => matches(a, value.some))) return false; continue }
        if (key === "NOT") { if (matches(row, value)) return false; continue }
        // A Json field's key, as Postgres reads it: a missing key is no value
        // at all, which "not" leaves out and DbNull finds.
        if (value !== null && typeof value === "object" && "path" in value) {
            const v = row[key]?.[value.path[0]]
            if ("gt" in value) { if (!(typeof v === "number" && v > value.gt)) return false; continue }
            if ("not" in value) { if (v === undefined || v === value.not) return false; continue }
            if (value.equals === Prisma.DbNull) { if (v !== undefined) return false; continue }
            throw new Error(`unsupported: ${key} ${JSON.stringify(value)}`)
        }
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

const seen = { paid: [] as string[], writes: {} as Record<string, any> }
const findMany = async ({ where }: any) => fixture.tasks.filter(t => matches(t, where)).map(t => structuredClone(t))
/** Run as a task is held for payment; a test sets it to change a task just then. */
const onHold = { run: () => {} }
const state = { session: null as any }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))
vi.mock("@/lib/prisma", () => {
    const tx: any = {
        task: {
            findMany,
            count: async ({ where }: any) => (await findMany({ where })).length,
            update: async ({ where, data }: any) => { seen.paid.push(where.id); seen.writes[where.id] = data; return {} },
            updateMany: async ({ where }: any) => { seen.paid.push(...(where.id?.in ?? [])); return { count: 0 } },
        },
        auditLog: { create: async () => ({}) },
        // The rows it pays, locked first.
        $queryRaw: async () => { onHold.run(); return [] },
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

/**
 * What the Costs page shows this payer for these filters, as Mark all as
 * paid confirms it (CLIENTS_PLAN.md §4.1): the page's own, so a payment by
 * filters is refused if the page and the button count it differently.
 */
async function shown(actor: keyof typeof ACTORS, filters: object) {
    state.session = { user: stepUpConfirmed(ACTORS[actor]) }
    const { default: CostsPage } = await import("@/app/(dashboard)/dashboard/costs/page")
    const page: any = await CostsPage({ searchParams: Promise.resolve(filters as any) })
    return page.props.toPay?.digest ?? "nothing"
}

async function send(actor: keyof typeof ACTORS, body: object) {
    state.session = { user: stepUpConfirmed(ACTORS[actor]) }
    seen.paid = []
    seen.writes = {}
    const { POST } = await import("@/app/api/tasks/payment/bulk/route")
    const res = await POST(new Request("https://nizmo.test/api/tasks/payment/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))
    return { status: res.status, paid: [...new Set(seen.paid)].sort() }
}

/** Pays by ids, or by filters as confirmed on the page they show. */
async function pay(actor: keyof typeof ACTORS, body: { taskIds?: string[]; filters?: object }) {
    const confirm = body.filters ? { digest: await shown(actor, body.filters) } : undefined
    return (await send(actor, { ...body, confirm })).paid
}

const EVERY_ID = { taskIds: TASKS.map(t => t.id) }

beforeEach(() => { seen.paid = []; seen.writes = {}; fixture.tasks = TASKS })

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

describe("with one employee picked, Mark all as paid pays that employee's shares only", () => {
    beforeEach(() => { fixture.tasks = [...TASKS, SHARED] })

    it("an Admin: their share of each task, and the rest of a shared task left to pay", async () => {
        expect(await pay("admin", { filters: { employeeId: "emp" } })).toEqual(["t-shared", "t-team"])
        // A shared task waits for its other member's share; one with no other is paid.
        expect(seen.writes["t-shared"].memberPaymentStatus).toEqual({ emp: "PAID" })
        expect(seen.writes["t-shared"].paymentStatus).toBeUndefined()
        expect(seen.writes["t-team"]).toMatchObject({ memberPaymentStatus: { emp: "PAID" }, paymentStatus: "PAID", status: "COMPLETED" })
    })

    it("and the task is paid with its last share", async () => {
        fixture.tasks = [{ ...SHARED, memberPaymentStatus: { loner: "PAID" } }]
        expect(await pay("admin", { filters: { employeeId: "emp" } })).toEqual(["t-shared"])
        expect(seen.writes["t-shared"]).toMatchObject({ memberPaymentStatus: { emp: "PAID", loner: "PAID" }, paymentStatus: "PAID", status: "COMPLETED" })
    })

    it("not a task where their share is paid already, or nothing", async () => {
        fixture.tasks = [{ ...SHARED, memberPaymentStatus: { emp: "PAID" } }, { ...SHARED, id: "t-zero", memberCosts: { emp: 0, loner: 50 } }]
        expect(await pay("admin", { filters: { employeeId: "emp" } })).toEqual([])
    })

    it("a share with no status is still to pay", async () => {
        fixture.tasks = [{ ...SHARED, memberPaymentStatus: { loner: "PENDING_PAYMENT" } }]
        expect(await pay("admin", { filters: { employeeId: "emp" } })).toEqual(["t-shared"])
    })

    it("a Team Leader: nothing for someone outside the team, on a task the team shares", async () => {
        expect(await pay("leader", { filters: { employeeId: "loner" } })).toEqual([])
    })

    it("with no one picked, every share of every task, as before", async () => {
        expect(await pay("admin", { filters: {} })).toEqual(["t-loner", "t-own", "t-shared", "t-team"])
        expect(seen.writes["t-shared"]).toMatchObject({ memberPaymentStatus: { emp: "PAID", loner: "PAID" }, paymentStatus: "PAID" })
    })
})

describe("Mark all as paid pays only the client's and the location's costs the Costs page shows", () => {
    it("a client's", async () => {
        expect(await pay("admin", { filters: { clientId: "acme" } })).toEqual(["t-loner", "t-team"])
    })

    it("those with no client", async () => {
        expect(await pay("admin", { filters: { clientId: "none" } })).toEqual(["t-own"])
    })

    it("a location's, and a client's location with its client", async () => {
        expect(await pay("admin", { filters: { locationId: "acme-site" } })).toEqual(["t-loner"])
        expect(await pay("admin", { filters: { clientId: "acme", locationId: "port" } })).toEqual([])
    })

    it("never another company's client, whatever the filter names", async () => {
        expect(await pay("admin", { filters: { clientId: "far" } })).toEqual([])
    })
})

describe("Mark all as paid pays exactly what was confirmed (CLIENTS_PLAN.md §4.1)", () => {
    afterEach(() => { onHold.run = () => {}; TASKS.forEach(t => { t.totalCost = 10; t.paymentStatus = "PENDING_PAYMENT" }) })

    it("pays nothing without a confirmation of what's paid", async () => {
        expect(await send("admin", { filters: {} })).toEqual({ status: 400, paid: [] })
    })

    it("pays nothing, and says to look again, when a cost changed since the list was shown", async () => {
        const digest = await shown("admin", {})
        TASKS.find(t => t.id === "t-loner")!.totalCost = 25
        expect(await send("admin", { filters: {}, confirm: { digest } })).toEqual({ status: 409, paid: [] })
    })

    it("pays nothing when one was paid by someone else meanwhile, as the tasks are held", async () => {
        const digest = await shown("admin", {})
        // Between the check and the payment: the tasks are held, and checked again.
        onHold.run = () => { TASKS.find(t => t.id === "t-own")!.paymentStatus = "PAID" }
        expect(await send("admin", { filters: {}, confirm: { digest } })).toEqual({ status: 409, paid: [] })
    })

    it("pays what was confirmed when nothing changed", async () => {
        expect(await send("admin", { filters: {}, confirm: { digest: await shown("admin", {}) } })).toEqual({ status: 200, paid: ["t-loner", "t-own", "t-team"] })
    })
})
