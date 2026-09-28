import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, taskState, as, withBody, TASKS, PEOPLE } from "./task-access.harness"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Reviewing a task takes a real decision; recording its payment takes a real
 * status, on reviewed work, for one of its people. Found by running the task flow in the app: anything else was
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

const review = async (body: unknown) => (await import("@/app/api/tasks/[id]/review/route")).POST(withBody("POST", "/api/tasks/t-emp/review", body), { params: { id: "t-emp" } } as any)

describe("reviewing a task", () => {
    beforeEach(() => { taskState.status = "SUBMITTED" })

    it("takes approved, rejected or completed, never a rejection by default", async () => {
        // An empty or mistyped request used to reject the task and take its
        // points away.
        expect((await review({})).status).toBe(400)
        expect((await review({ status: "APPROVE" })).status).toBe(400)
        expect((await review({ action: "REJECTED" })).status).toBe(200)
        expect((await review({ status: "COMPLETED", difficulty: 3 })).status).toBe(200)
    })

    it("with a difficulty from 0 to 10, as a new task has", async () => {
        expect((await review({ status: "COMPLETED", difficulty: -5 })).status).toBe(400)
        expect((await review({ status: "COMPLETED", difficulty: 1000000 })).status).toBe(400)
        expect((await review({ status: "COMPLETED", difficulty: "3" })).status).toBe(400)
        expect((await review({ status: "COMPLETED", difficulty: 10 })).status).toBe(200)
    })
})

const penalise = async (body: unknown) => (await import("@/app/api/tasks/[id]/penalty/route")).POST(withBody("POST", "/api/tasks/t-emp/penalty", body), { params: { id: "t-emp" } } as any)

describe("penalising a task", () => {
    it("falls on one of the task's own people, never anyone else", async () => {
        // "other" is in another company; "loner" is in this one but not on
        // the task. Either used to lose pay to whoever named them.
        expect((await penalise({ userId: "other", amount: 1 })).status).toBe(400)
        expect((await penalise({ userId: "loner", amount: 1 })).status).toBe(400)
        expect((await penalise({ userId: "emp", amount: 1 })).status).toBe(200)
    })

    it("by a number of days above 0, refused plainly rather than as a server error", async () => {
        expect((await penalise({ userId: "emp", amount: -3 })).status).toBe(400)
        expect((await penalise({ userId: "emp", amount: 1e9 })).status).toBe(400)
    })

    it("from someone whose role reaches only a team, falls only on that team, even on a shared task", async () => {
        // t-emp shared by "emp" (the Team Leader's report) and "loner" (no
        // team): the leader can open it, but only emp's pay is theirs to cut.
        const before = TASKS["t-emp"].assignees
        TASKS["t-emp"].assignees = [{ ...PEOPLE.emp }, { ...PEOPLE.loner }]
        try {
            as("leader")
            expect((await penalise({ userId: "loner", amount: 1 })).status).toBe(403)
            expect((await penalise({ userId: "emp", amount: 1 })).status).toBe(200)
        } finally {
            TASKS["t-emp"].assignees = before
        }
    })

    it("says what the allowed amount is when it refuses one", async () => {
        expect(JSON.stringify(await (await penalise({ userId: "emp", amount: 5000 })).json())).toContain("1000")
    })
})

const submit = async () => (await import("@/app/api/tasks/[id]/submit/route")).PUT(withBody("PUT", "/api/tasks/t-emp/submit", { note: "Done again" }), { params: { id: "t-emp" } } as any)

describe("submitting a task", () => {
    it("is not done again once it is decided, which counted its points twice", async () => {
        as("employee")
        for (const status of ["APPROVED", "COMPLETED"]) {
            taskState.status = status
            expect((await submit()).status, status).toBe(400)
        }
        for (const status of ["IN_PROGRESS", "REJECTED"]) {
            taskState.status = status
            expect((await submit()).status, status).toBe(200)
        }
    })
})
