import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, taskState, as, withBody } from "./task-access.harness"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Recording a task's payment takes a real status, on reviewed work, for one
 * of its people. Found by running the task flow in the app: anything else was
 * taken as "not paid", which put a paid, completed task back to Approved with
 * every assignee unpaid; and a task still in progress could be marked paid,
 * which completed it without a review.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const pay = async (body: unknown) => (await import("@/app/api/tasks/[id]/payment/route")).PUT(withBody("PUT", "/api/tasks/t-emp/payment", body), { params: { id: "t-emp" } } as any)

beforeEach(() => { as("admin"); taskState.status = "APPROVED" })

describe("recording a task's payment", () => {
    it("takes paid or not paid, and nothing else", async () => {
        expect((await pay({})).status).toBe(400)
        expect((await pay({ isPaid: true })).status).toBe(400)
        expect((await pay({ paymentStatus: "SOMETIMES" })).status).toBe(400)
        expect((await pay({ paymentStatus: "PAID" })).status).toBe(200)
        expect((await pay({ paymentStatus: "PENDING_PAYMENT" })).status).toBe(200)
    })

    it("only on reviewed work", async () => {
        for (const status of ["PENDING", "IN_PROGRESS", "SUBMITTED"]) {
            taskState.status = status
            expect((await pay({ paymentStatus: "PAID" })).status, status).toBe(400)
        }
        for (const status of ["APPROVED", "COMPLETED", "REJECTED"]) {
            taskState.status = status
            expect((await pay({ paymentStatus: "PAID" })).status, status).toBe(200)
        }
    })

    it("for one of the task's own people", async () => {
        expect((await pay({ paymentStatus: "PAID", targetUserId: "loner" })).status).toBe(400)
        expect((await pay({ paymentStatus: "PAID", targetUserId: "emp" })).status).toBe(200)
    })
})
