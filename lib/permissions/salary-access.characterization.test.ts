import { describe, it, expect, vi } from "vitest"

vi.setConfig({ testTimeout: 30_000 })

/**
 * Who may reach salaries and adjustments today — recorded, not reasoned about.
 *
 * Same method as the payroll and day-off records: the real exported handlers
 * run as every kind of caller, including the shared verifyResourceAccess check
 * they call, and the answer is recorded. SalaryService is mocked because it
 * makes no access decision — it only uses the role to attribute audit entries —
 * so the decisions under test are all in the routes.
 *
 * Written and passing against the code before salaries moved to can(), and
 * required to pass unchanged after.
 */

const state = { session: null as any }

const USERS: Record<string, any> = {
    emp:   { id: "emp",   companyId: "c1", teamLeaderId: "tl" },
    tl:    { id: "tl",    companyId: "c1", teamLeaderId: null },
    other: { id: "other", companyId: "c2", teamLeaderId: null },
}

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        rateLimit: { findUnique: async () => null, upsert: async () => ({ count: 1 }) },
        user: { findUnique: async ({ where }: any) => USERS[where.id] ?? null },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" },
}))
vi.mock("@/lib/services/salary.service", () => ({
    SalaryService: {
        getAdjustments: async () => [],
        reverseAdjustment: async () => ({}),
        rollbackAdjustment: async () => ({}),
        addAdjustment: async () => ({ id: "adj" }),
        ensureRecordsThrough: async () => {},
        historyWithPayslips: async () => [],
    },
}))

const ACTORS = {
    superAdmin: { id: "sa",     role: "SUPER_ADMIN", companyId: null },
    admin:      { id: "admin",  role: "ADMIN",       companyId: "c1" },
    otherAdmin: { id: "admin2", role: "ADMIN",       companyId: "c2" },
    leader:     { id: "tl",     role: "TEAM_LEADER", companyId: "c1" },
    employee:   { id: "emp",    role: "EMPLOYEE",    companyId: "c1" },
} as const
type ActorName = keyof typeof ACTORS

const url = (p: string) => `https://nizmo.test${p}`
const post = (p: string, body: unknown) => new Request(url(p), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
})

const MANAGERS_OF_C1: Record<ActorName, number> = {
    superAdmin: 200, admin: 200, otherAdmin: 403, leader: 403, employee: 403,
}
const MANAGERS_OF_C2: Record<ActorName, number> = {
    superAdmin: 200, admin: 403, otherAdmin: 200, leader: 403, employee: 403,
}

type Case = { name: string; run: () => Promise<Response>; expected: Record<ActorName, number> }

const adjustments = (id: string) => async () =>
    (await import("@/app/api/users/[id]/adjustments/route")).GET(new Request(url(`/api/users/${id}/adjustments`)), { params: { id } })
const history = (id: string) => async () =>
    (await import("@/app/api/users/[id]/salary-history/route")).GET(new Request(url(`/api/users/${id}/salary-history`)), { params: { id } })

const CASES: Case[] = [
    { name: "an employee's adjustments", run: adjustments("emp"), expected: MANAGERS_OF_C1 },
    { name: "another company's employee's adjustments", run: adjustments("other"), expected: MANAGERS_OF_C2 },
    {
        name: "a bonus",
        run: async () => (await import("@/app/api/users/[id]/bonus/route")).POST(post("/api/users/emp/bonus", { amount: 1, reason: "r" }), { params: { id: "emp" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "a deduction",
        run: async () => (await import("@/app/api/users/[id]/deduction/route")).POST(post("/api/users/emp/deduction", { amount: 1, reason: "r" }), { params: { id: "emp" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "reversing an adjustment",
        run: async () => (await import("@/app/api/users/[id]/adjustments/[adjId]/reverse/route")).POST(post("/api/users/emp/adjustments/a1/reverse", { reason: "r" }), { params: { id: "emp", adjId: "a1" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "rolling back an adjustment",
        run: async () => (await import("@/app/api/users/[id]/adjustments/[adjId]/rollback/route")).POST(post("/api/users/emp/adjustments/a1/rollback", {}), { params: { id: "emp", adjId: "a1" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "an employee's salary history",
        run: history("emp"),
        // Their own, and managers. Not their Team Leader.
        expected: { ...MANAGERS_OF_C1, employee: 200 },
    },
    {
        name: "a Team Leader's salary history",
        run: history("tl"),
        expected: { ...MANAGERS_OF_C1, leader: 200 },
    },
    { name: "another company's employee's salary history", run: history("other"), expected: MANAGERS_OF_C2 },
]

describe("salaries and adjustments — recorded access", () => {
    for (const c of CASES) {
        for (const actor of Object.keys(ACTORS) as ActorName[]) {
            it(`${c.name} as ${actor}`, async () => {
                state.session = { user: { ...ACTORS[actor] } }
                const res = await c.run()
                expect(res.status).toBe(c.expected[actor])
            })
        }
    }
})
