import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A task's penalty falls only on the task's own people.
 *
 * POST /api/tasks/<id>/penalty checked that the caller may act on the task,
 * then deducted pay from whichever userId the request named, without checking
 * that person was on the task or even in the company. So a company Admin or
 * Team Leader could take days of pay from any account whose id they had, in
 * any company. These tests drive the real route and TaskService; the database
 * is a stand-in holding one task, assigned to one person.
 */

const session = { value: null as any }
const deducted: { userId: string; amount: number }[] = []
// Shared by the Team Leader's report (emp-1) and someone on another team (emp-2).
const TASK = { id: "task-1", companyId: "co-1", comments: [], assignees: [{ id: "emp-1", teamLeaderId: "tl-1" }, { id: "emp-2", teamLeaderId: "tl-2" }] }

vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/salary.service", () => ({
    SalaryService: {
        applyAdjustment: async (input: { userId: string; amount: number }) => {
            if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1000) throw new Error("INVALID_ADJUSTMENT_AMOUNT")
            deducted.push({ userId: input.userId, amount: input.amount })
            return { month: 9, year: 2026 }
        },
    },
}))
vi.mock("@/lib/prisma", () => {
    const client: any = {
        task: { findUnique: async ({ where }: any) => where.id === TASK.id ? TASK : null, update: async () => TASK },
        user: { findUnique: async () => null },
        rateLimit: { upsert: async () => ({ count: 1 }) },
        auditLog: { create: async () => ({}) },
    }
    client.$transaction = async (fn: any) => fn(client)
    return { prisma: client }
})

const penalise = async (body: unknown) => {
    const { POST } = await import("@/app/api/tasks/[id]/penalty/route")
    return POST(new Request("https://nizmo.test/api/tasks/task-1/penalty", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: TASK.id }) } as any)
}

describe("a task's penalty", () => {
    beforeEach(() => {
        deducted.length = 0
        session.value = { user: { id: "admin-1", role: "ADMIN", companyId: "co-1" } }
    })

    it("is refused for someone not on the task, in this company or another", async () => {
        expect((await penalise({ userId: "someone-in-another-company", amount: 3 })).status).toBe(400)
        expect((await penalise({ userId: "colleague-not-on-task", amount: 3 })).status).toBe(400)
        expect(deducted).toEqual([])
    })

    it("falls on the task's own assignee", async () => {
        expect((await penalise({ userId: "emp-1", amount: 3 })).status).toBe(200)
        expect(deducted).toEqual([{ userId: "emp-1", amount: 3 }])
    })

    it("refuses an amount out of range plainly, not as a server error", async () => {
        expect((await penalise({ userId: "emp-1", amount: -3 })).status).toBe(400)
        expect(deducted).toEqual([])
    })

    it("from a Team Leader, falls only on their own team, even on a shared task", async () => {
        session.value = { user: { id: "tl-1", role: "TEAM_LEADER", companyId: "co-1" } }
        expect((await penalise({ userId: "emp-2", amount: 3 })).status).toBe(403)
        expect(deducted).toEqual([])
        expect((await penalise({ userId: "emp-1", amount: 3 })).status).toBe(200)
        expect(deducted).toEqual([{ userId: "emp-1", amount: 3 }])
    })

    it("says what the allowed amount is when it refuses one", async () => {
        const body = await (await penalise({ userId: "emp-1", amount: 5000 })).json()
        expect(JSON.stringify(body)).toContain("1000")
    })
})
