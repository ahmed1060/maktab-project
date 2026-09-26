import { describe, it, expect, vi, beforeEach } from "vitest"

// The first import of a route loads the whole service graph.
vi.setConfig({ testTimeout: 30_000 })

/**
 * Who may reach day off today — recorded, not reasoned about.
 *
 * Same method as payroll-access.characterization.test.ts: the real exported
 * handlers and the real DayOffService run, as every kind of caller, and the
 * answer is recorded. Only the session, the database and the services day off
 * calls into (notifications, salary adjustments, audit) are mocked. The
 * database mock returns fixtures for the lookups the access decisions read and
 * accepts every write, so a refusal can only come from an access check.
 *
 * Written and passing against the code before day off moved to can(), and
 * required to pass unchanged after.
 *
 * One recorded behaviour is worth naming: an Admin may approve their own
 * leave request. ROLES_PLAN.md says nobody should approve their own request,
 * but Part A changes nobody's access, so it is recorded here as it is. Closing
 * it is a deliberate change of its own.
 */

const state = { session: null as any }
const seen = { listWhere: null as any, notified: [] as string[] }

const USERS: Record<string, any> = {
    emp:   { id: "emp",   companyId: "c1", role: "EMPLOYEE", teamLeaderId: "tl", salary: 1000, firstName: "E", lastName: "M" },
    admin: { id: "admin", companyId: "c1", role: "ADMIN",    teamLeaderId: null, salary: 2000, firstName: "A", lastName: "D" },
}
const REQUESTS: Record<string, any> = {
    "pending-emp":   { id: "pending-emp",   userId: "emp",   status: "PENDING",  daysDeducted: 0, deductionType: "CREDIT" },
    "pending-admin": { id: "pending-admin", userId: "admin", status: "PENDING",  daysDeducted: 0, deductionType: "CREDIT" },
    "approved-emp":  { id: "approved-emp",  userId: "emp",   status: "APPROVED", daysDeducted: 1, deductionType: "CREDIT" },
}
const withUser = (r: any) => r ? { ...r, date: new Date(), endDate: null, type: "REGULAR", user: USERS[r.userId] } : null

/**
 * Any model, any method: reads find nothing, writes succeed. The handful of
 * lookups an access decision reads are overridden below with fixtures. A
 * permissive default is deliberate — the question here is only whether an
 * access check refuses, so everything after the checks must simply work.
 */
function permissiveModel(overrides: Record<string, any> = {}) {
    const defaults: Record<string, any> = {
        findUnique: async () => null,
        findFirst: async () => null,
        findMany: async () => [],
        count: async () => 0,
        aggregate: async () => ({ _sum: {}, _count: 0 }),
        groupBy: async () => [],
        create: async ({ data }: any) => ({ id: "new", ...data }),
        update: async ({ where, data }: any) => ({ ...where, ...data }),
        upsert: async ({ create }: any) => ({ id: "new", ...create }),
        updateMany: async () => ({ count: 0 }),
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 }),
    }
    return { ...defaults, ...overrides }
}

const models: Record<string, any> = {
    rateLimit: permissiveModel({ upsert: async () => ({ count: 1 }) }),
    dayOffRequest: permissiveModel({
        findUnique: async ({ where }: any) => withUser(REQUESTS[where.id]),
        findMany: async ({ where }: any) => { seen.listWhere = where; return [] },
        update: async ({ where, data }: any) => ({ ...REQUESTS[where.id], ...data }),
    }),
    user: permissiveModel({
        findUnique: async ({ where }: any) => USERS[where.id] ?? null,
        findMany: async ({ where }: any) => { seen.notified.push(JSON.stringify(where)); return [] },
        update: async ({ where }: any) => ({ ...USERS[where.id], dayOffCredit: 10 }),
    }),
}

const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "$transaction") return async (fn: any) => typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
        if (prop === "then") return undefined
        return models[prop] ??= permissiveModel()
    },
})

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" },
}))
vi.mock("@/lib/services/notification.service", () => ({
    NotificationService: { notify: async () => {}, notifyMany: async () => {} },
}))
vi.mock("@/lib/services/salary.service", () => ({ SalaryService: { applyAdjustment: async () => {} } }))

const ACTORS = {
    superAdmin: { id: "sa",     role: "SUPER_ADMIN", companyId: null },
    admin:      { id: "admin",  role: "ADMIN",       companyId: "c1" },
    otherAdmin: { id: "admin2", role: "ADMIN",       companyId: "c2" },
    leader:     { id: "tl",     role: "TEAM_LEADER", companyId: "c1" },
    employee:   { id: "emp",    role: "EMPLOYEE",    companyId: "c1" },
} as const
type ActorName = keyof typeof ACTORS
const as = (name: ActorName) => { state.session = { user: { ...ACTORS[name] } } }

const url = (p: string) => `https://nizmo.test${p}`
const send = (method: string, p: string, body: unknown) => new Request(url(p), {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
})

beforeEach(() => { seen.listWhere = null; seen.notified = [] })

// --- the company's request list ---------------------------------------------

describe("the day-off request list — recorded access", () => {
    /** status, and the company the list was filtered to ("any" = unfiltered). */
    const EXPECTED: Record<ActorName, [number, string | null]> = {
        superAdmin: [200, "c2"],   // a Super Admin's filter is honoured
        admin:      [200, "c1"],   // an Admin's is ignored: their own company
        otherAdmin: [200, "c2"],
        leader:     [403, null],
        employee:   [403, null],
    }
    for (const actor of Object.keys(ACTORS) as ActorName[]) {
        it(`as ${actor}, asking for company c2`, async () => {
            as(actor)
            const { GET } = await import("@/app/api/admin/day-off-requests/route")
            const res = await GET(new Request(url("/api/admin/day-off-requests?companyId=c2")))
            expect(res.status).toBe(EXPECTED[actor][0])
            expect(seen.listWhere?.user?.companyId ?? null).toBe(EXPECTED[actor][1])
        })
    }

    it("a Super Admin naming no company sees every company", async () => {
        as("superAdmin")
        const { GET } = await import("@/app/api/admin/day-off-requests/route")
        const res = await GET(new Request(url("/api/admin/day-off-requests")))
        expect(res.status).toBe(200)
        expect(seen.listWhere).toEqual({})
    })
})

// --- deciding a request -------------------------------------------------------

type Case = { name: string; run: () => Promise<Response>; expected: Record<ActorName, number> }

const MANAGERS_OF_C1: Record<ActorName, number> = {
    superAdmin: 200, admin: 200, otherAdmin: 403, leader: 403, employee: 403,
}

const patch = async (id: string, body: unknown) =>
    (await import("@/app/api/admin/day-off-requests/[id]/route")).PATCH(send("PATCH", `/api/admin/day-off-requests/${id}`, body), { params: { id } })

const CASES: Case[] = [
    { name: "approving an employee's request", run: () => patch("pending-emp", { status: "APPROVED" }), expected: MANAGERS_OF_C1 },
    { name: "rejecting an employee's request", run: () => patch("pending-emp", { status: "REJECTED", rejectionReason: "busy" }), expected: MANAGERS_OF_C1 },
    {
        // Recorded as it is: the Admin whose request it is may approve it.
        name: "approving the Admin's own request", run: () => patch("pending-admin", { status: "APPROVED" }), expected: MANAGERS_OF_C1,
    },
    {
        name: "re-evaluating an approved request",
        run: async () => (await import("@/app/api/admin/day-off-requests/[id]/reevaluate/route")).POST(send("POST", "/api/admin/day-off-requests/approved-emp/reevaluate", { newDays: 0.5 }), { params: { id: "approved-emp" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "a person's leave history",
        run: async () => (await import("@/app/api/users/[id]/day-off-history/route")).GET(new Request(url("/api/users/emp/day-off-history")), { params: { id: "emp" } }),
        // The employee reads their own. The Team Leader does not, though emp is
        // on their team: leave history is Admin-only today.
        expected: { ...MANAGERS_OF_C1, employee: 200 },
    },
]

describe("deciding and reading leave — recorded access", () => {
    for (const c of CASES) {
        for (const actor of Object.keys(ACTORS) as ActorName[]) {
            it(`${c.name} as ${actor}`, async () => {
                as(actor)
                const res = await c.run()
                expect(res.status).toBe(c.expected[actor])
            })
        }
    }
})

// --- who is told ------------------------------------------------------------

describe("who is notified of a new request — recorded", () => {
    it("the requester's company's Admins, and every Super Admin", async () => {
        as("employee")
        const { POST } = await import("@/app/api/day-off-requests/route")
        const res = await POST(send("POST", "/api/day-off-requests", { date: "2026-10-04", type: "REGULAR" }))
        expect(res.status).toBe(201)
        expect(seen.notified.map(w => JSON.parse(w))).toContainEqual({
            OR: [{ role: "ADMIN", companyId: "c1" }, { role: "SUPER_ADMIN" }],
        })
    })
})
