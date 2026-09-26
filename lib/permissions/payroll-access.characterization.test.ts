import { describe, it, expect, vi, beforeEach } from "vitest"
import { withGrants } from "./test-actors"

/**
 * Who may reach payroll today — recorded, not reasoned about.
 *
 * Part A of ROLES_PLAN.md moves every access check onto can(). Its one hard
 * requirement is that nobody's access changes on the day it ships. A table of
 * "what each role may do" written by reading the code cannot prove that on its
 * own: if the code was misread, the table and a test comparing against it are
 * wrong together. So this drives the real exported handlers of every
 * payroll-related route, as each kind of caller, and records the answer:
 * allowed or refused, and — for the month routes — which company the work was
 * actually done for, since that is where a tenancy leak would show.
 *
 * It was written and passed against the code as it stood before the migration,
 * and must keep passing, unchanged, after it.
 *
 * Only the session, the database and the services behind the routes are
 * mocked. Every access decision under test runs for real.
 */

const state = { session: null as any }

const fx = {
    payslips: {
        "ps-visible": { id: "ps-visible", userId: "emp", companyId: "c1", payslipsVisible: true },
        "ps-hidden":  { id: "ps-hidden",  userId: "emp3", companyId: "c3", payslipsVisible: false },
    } as Record<string, any>,
    users: {
        emp:  { id: "emp",  companyId: "c1", teamLeaderId: "tl", payslipsVisible: true },
        emp3: { id: "emp3", companyId: "c3", teamLeaderId: null, payslipsVisible: false },
    } as Record<string, any>,
    debts: { "d1": { id: "d1", companyId: "c1", status: "OUTSTANDING", amount: 100, recoveredAmount: 0 } } as Record<string, any>,
    settlements: { "s1": { id: "s1", companyId: "c1" } } as Record<string, any>,
}

const calls = { companyId: [] as string[] }
const record = (companyId: string) => { calls.companyId.push(companyId) }

function payslipRow(p: any) {
    return {
        ...p,
        lines: [], earningsAmount: 1, deductionsAmount: 0, netAmount: 1, carriedAmount: 0,
        daysPaid: 30, excluded: false, exclusionReason: null, emailedAt: null,
        user: { id: p.userId, firstName: "A", lastName: "B", email: "a@b.c", companyId: p.companyId },
        payrollRun: {
            month: 9, year: 2026, status: "APPROVED", payrollDay: 25, paidAt: null,
            company: { id: p.companyId, name: "Co", logoUrl: null, payslipsVisible: p.payslipsVisible },
        },
    }
}

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        rateLimit: {
            findUnique: async () => null,
            upsert: async () => ({ count: 1 }),
            update: async () => ({ count: 1, resetAt: new Date(Date.now() + 60_000) }),
        },
        payslip: {
            findUnique: async ({ where }: any) => fx.payslips[where.id] ? payslipRow(fx.payslips[where.id]) : null,
            findMany: async () => [],
        },
        user: {
            findUnique: async ({ where }: any) => {
                const u = fx.users[where.id]
                return u ? { ...u, company: { payslipsVisible: u.payslipsVisible } } : null
            },
        },
        debt: {
            findUnique: async ({ where }: any) => fx.debts[where.id] ?? null,
            findMany: async () => [],
            update: async ({ where }: any) => ({ id: where.id, status: "WAIVED" }),
        },
        finalSettlement: {
            findUnique: async ({ where }: any) => {
                const s = fx.settlements[where.id]
                return s ? {
                    ...s, netAmount: 0, earnedAmount: 0, paidAmount: 0, debtRecoveredAmount: 0,
                    status: "PENDING", dueDate: null, reason: null, emailedAt: null, lastWorkingDay: new Date(),
                    user: { firstName: "A", lastName: "B", email: "a@b.c" },
                    company: { id: s.companyId, name: "Co", logoUrl: null },
                } : null
            },
        },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: {
        log: async () => {},
        logSystemError: async () => "ref",
        friendlyErrorMessage: () => "error",
    },
}))
vi.mock("@/lib/services/payroll-run.service", () => ({
    PayrollRunService: {
        view: async (c: string) => { record(c); return {} },
        saveDraft: async (c: string) => { record(c); return { id: "run", status: "DRAFT" } },
        approve: async (c: string) => { record(c); return { runId: "run" } },
    },
}))
vi.mock("@/lib/services/payroll-delivery.service", () => ({
    PayrollDeliveryService: {
        exportCsv: async (c: string) => { record(c); return { filename: "x.csv", body: "" } },
        issueBatch: async (c: string) => { record(c); return {} },
        markPaid: async (c: string) => { record(c); return { id: "run", status: "PAID", paidAt: new Date() } },
        resendSettlement: async () => ({ outcome: "SENT" }),
    },
}))
vi.mock("@/lib/services/settlement.service", () => ({
    SettlementService: { forUser: async () => [] },
}))

// --- callers ----------------------------------------------------------------

const ACTORS = {
    superAdmin: { id: "sa",     role: "SUPER_ADMIN", companyId: null },
    admin:      { id: "admin",  role: "ADMIN",       companyId: "c1" },
    otherAdmin: { id: "admin2", role: "ADMIN",       companyId: "c2" },
    leader:     { id: "tl",     role: "TEAM_LEADER", companyId: "c1" },
    employee:   { id: "emp",    role: "EMPLOYEE",    companyId: "c1" },
} as const
type ActorName = keyof typeof ACTORS

function as(name: ActorName) {
    state.session = { user: withGrants({ ...ACTORS[name] }) }
}

const url = (path: string) => `https://nizmo.test${path}`
const json = (path: string, body: unknown) => new Request(url(path), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
})

beforeEach(() => { calls.companyId = [] })

// --- the month routes ---------------------------------------------------------

/**
 * Every month route, asked for company c2 by name. Only a Super Admin's naming
 * is honoured; an Admin is held to their own company whatever they send.
 */
const MONTH_ROUTES = [
    { name: "view month",     mod: () => import("@/app/api/payroll/[year]/[month]/route"),         method: "GET" },
    { name: "save draft",     mod: () => import("@/app/api/payroll/[year]/[month]/route"),         method: "POST" },
    { name: "approve",        mod: () => import("@/app/api/payroll/[year]/[month]/approve/route"), method: "POST" },
    { name: "export",         mod: () => import("@/app/api/payroll/[year]/[month]/export/route"),  method: "GET" },
    { name: "issue payslips", mod: () => import("@/app/api/payroll/[year]/[month]/issue/route"),   method: "POST" },
    { name: "mark paid",      mod: () => import("@/app/api/payroll/[year]/[month]/paid/route"),    method: "POST" },
] as const

/** status, and the company the work was done for (null = nothing done). */
const MONTH_EXPECTED: Record<ActorName, [number, string | null]> = {
    superAdmin: [200, "c2"],
    admin:      [200, "c1"],
    otherAdmin: [200, "c2"],
    leader:     [403, null],
    employee:   [403, null],
}

describe("payroll month routes — recorded access", () => {
    for (const route of MONTH_ROUTES) {
        for (const actor of Object.keys(ACTORS) as ActorName[]) {
            it(`${route.name} as ${actor}`, async () => {
                as(actor)
                const mod: any = await route.mod()
                const path = "/api/payroll/2026/9"
                const req = route.method === "GET"
                    ? new Request(url(`${path}?companyId=c2`))
                    : json(path, { companyId: "c2" })
                const res = await mod[route.method](req, { params: { year: "2026", month: "9" } })
                const [status, company] = MONTH_EXPECTED[actor]
                expect(res.status).toBe(status)
                expect(calls.companyId[0] ?? null).toBe(company)
            })
        }
    }
})

// --- the document routes ------------------------------------------------------

type Case = { name: string; run: () => Promise<Response>; expected: Record<ActorName, number> }

const MANAGERS_OF_C1: Record<ActorName, number> = {
    superAdmin: 200, admin: 200, otherAdmin: 403, leader: 403, employee: 403,
}

const DOCUMENT_CASES: Case[] = [
    {
        name: "a payslip, owner's company shows payslips",
        run: async () => (await import("@/app/api/payslips/[id]/route")).GET(new Request(url("/api/payslips/ps-visible")), { params: { id: "ps-visible" } }),
        expected: { ...MANAGERS_OF_C1, employee: 200 },
    },
    {
        name: "a payslip, owner's company hides payslips",
        // emp3 is in c3; nobody in this table manages c3 but the Super Admin,
        // and the owner is not among these callers — so only the Super Admin.
        run: async () => (await import("@/app/api/payslips/[id]/route")).GET(new Request(url("/api/payslips/ps-hidden")), { params: { id: "ps-hidden" } }),
        expected: { superAdmin: 200, admin: 403, otherAdmin: 403, leader: 403, employee: 403 },
    },
    {
        name: "a person's payslip list",
        run: async () => (await import("@/app/api/users/[id]/payslips/route")).GET(new Request(url("/api/users/emp/payslips")), { params: { id: "emp" } }),
        expected: { ...MANAGERS_OF_C1, employee: 200 },
    },
    {
        name: "a person's debts",
        run: async () => (await import("@/app/api/users/[id]/debts/route")).GET(new Request(url("/api/users/emp/debts")), { params: { id: "emp" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "waiving a debt",
        run: async () => (await import("@/app/api/debts/[id]/waive/route")).POST(json("/api/debts/d1/waive", { reason: "goodwill" }), { params: { id: "d1" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "a settlement",
        run: async () => (await import("@/app/api/settlements/[id]/route")).GET(new Request(url("/api/settlements/s1")), { params: { id: "s1" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "resending a settlement",
        run: async () => (await import("@/app/api/settlements/[id]/resend/route")).POST(json("/api/settlements/s1/resend", {}), { params: { id: "s1" } }),
        expected: MANAGERS_OF_C1,
    },
    {
        name: "a person's settlements",
        run: async () => (await import("@/app/api/users/[id]/settlements/route")).GET(new Request(url("/api/users/emp/settlements")), { params: { id: "emp" } }),
        expected: MANAGERS_OF_C1,
    },
]

describe("payroll document routes — recorded access", () => {
    for (const c of DOCUMENT_CASES) {
        for (const actor of Object.keys(ACTORS) as ActorName[]) {
            it(`${c.name} as ${actor}`, async () => {
                as(actor)
                const res = await c.run()
                expect(res.status).toBe(c.expected[actor])
            })
        }
    }
})
