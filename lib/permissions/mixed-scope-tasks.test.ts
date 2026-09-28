import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, taskState, url, withBody } from "./task-access.harness"
import { encodeGrants } from "./grants"
import { stepUpConfirmed } from "./test-actors"

vi.setConfig({ testTimeout: 60_000 })

/**
 * A role that sees every task but acts only on its team's: tasks.view held
 * for the company, each action for a team. The action's own scope decides,
 * not the view's. The actor is "tl", who leads "emp"; "loner" is outside the
 * team. The built-in roles never mixed scopes, so only custom ones reach this.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}), upload: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))
vi.mock("@/lib/services/salary.service", () => ({ SalaryService: { applyAdjustment: async () => ({ id: "adj" }), ensureRecordExists: async () => {} } }))

const P = (id: string) => ({ params: { id } })
const ASSIGNEE: Record<string, string> = { "t-emp": "emp", "t-loner": "loner" }
const ACTIONS: [string, "tasks.edit" | "tasks.delete" | "tasks.review" | "tasks.pay" | "tasks.penalize" | "tasks.transfer", (t: string) => Promise<Response>][] = [
    ["edit details",    "tasks.edit",     async t => (await import("@/app/api/tasks/[id]/details/route")).PUT(withBody("PUT", `/api/tasks/${t}/details`, { id: t, title: "Renamed task" }), P(t))],
    ["delete",          "tasks.delete",   async t => (await import("@/app/api/tasks/[id]/delete/route")).DELETE(new Request(url(`/api/tasks/${t}/delete`), { method: "DELETE" }), P(t))],
    ["review",          "tasks.review",   async t => (await import("@/app/api/tasks/[id]/review/route")).POST(withBody("POST", `/api/tasks/${t}/review`, { status: "COMPLETED", difficulty: 3 }), P(t))],
    ["record payment",  "tasks.pay",      async t => { taskState.status = "APPROVED"; return (await import("@/app/api/tasks/[id]/payment/route")).PUT(withBody("PUT", `/api/tasks/${t}/payment`, { paymentStatus: "PAID" }), P(t)) }],
    ["apply a penalty", "tasks.penalize", async t => (await import("@/app/api/tasks/[id]/penalty/route")).POST(withBody("POST", `/api/tasks/${t}/penalty`, { userId: ASSIGNEE[t], amount: 1 }), P(t))],
    ["transfer",        "tasks.transfer", async t => (await import("@/app/api/tasks/[id]/transfer/route")).POST(withBody("POST", `/api/tasks/${t}/transfer`, { newAssigneeIds: ["emp"] }), P(t))],
]

beforeEach(() => { taskState.status = "SUBMITTED" })

describe("a role that sees every task and acts on its team's", () => {
    for (const [name, permission, run] of ACTIONS) {
        const onRole = () => {
            state.session = { user: stepUpConfirmed({ id: "tl", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "tasks.view": "COMPANY", "employees.view": "COMPANY", [permission]: "TEAM" } as any) }) }
        }
        it(`may ${name} on their team's task`, async () => {
            onRole()
            expect((await run("t-emp")).status).toBe(200)
        })
        it(`may not ${name} on another task in the company`, async () => {
            onRole()
            expect((await run("t-loner")).status).toBe(403)
        })
    }
})
