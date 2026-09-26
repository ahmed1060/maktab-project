import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, taskState, ACTOR_NAMES, as, url, withBody, type ActorName } from "./task-access.harness"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Who may do what with tasks today — recorded, not reasoned about.
 *
 * Same method as the other records: the real task routes, the real TaskService,
 * verifyResourceAccess and checkAssignees run as every kind of caller, against
 * four tasks — one assigned to an employee on the Team Leader's team, one to a
 * teamless employee, one to the Admin, and one in another company. Every value
 * was observed by running the code, then checked against a reading of it.
 *
 * Several observed behaviours are gaps, recorded exactly as they are because
 * Part A changes nobody's access. The screens hide all of them from employees;
 * the API does not refuse them:
 *
 * - (Fixed since recording: an Employee could create a task for anyone in
 *   their company, an Admin included. POST /api/tasks is now managers only.)
 * - (Fixed since recording: an Employee could review — approve — a task,
 *   their own included, and anyone in the company could mark a location
 *   verified. Both are now managers only.)
 * - (Fixed since recording: anyone in the company could acknowledge — clear
 *   the "edited" notice on — someone else's task. Only its assignees may now.)
 * - (Fixed since recording: submitting someone else's task, and transferring a
 *   task to someone in another company, were refused with unmapped 500s. Both
 *   now answer 403.)
 *
 * (Fixed since recording: deleting a note, cost or attachment from a task
 * failed with a 500 for everyone, because withStandardHandler did not parse
 * JSON bodies on DELETE. It does now, so TaskService.deleteItem's own rule — the
 * item's author, or a manager — is reached and recorded below.)
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}), upload: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))
vi.mock("@/lib/storage", () => ({ downloadTemplateBuffer: async () => Buffer.from("base") }))
vi.mock("@/lib/services/template-generator.service", () => ({ generateBulkTaskTemplate: async () => Buffer.from("xlsx") }))
vi.mock("@/lib/services/salary.service", () => ({ SalaryService: { applyAdjustment: async () => ({ id: "adj" }), ensureRecordExists: async () => {} } }))

type Row = [superAdmin: number, admin: number, otherAdmin: number, leader: number, employee: number]
const ORDER: ActorName[] = ["superAdmin", "admin", "otherAdmin", "leader", "employee"]

const later = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const P = (id: string) => ({ params: { id } })
const ASSIGNEE: Record<string, string> = { "t-emp": "emp", "t-loner": "loner", "t-admin": "admin", "t-other": "other" }

const create = (assignee: string) => async () =>
    (await import("@/app/api/tasks/route")).POST(withBody("POST", "/api/tasks", { title: "New task", description: "Something to do", assigneeIds: [assignee], deadline: later() }))

/** Per task: the action, the status the task is in for it, and the request. */
const ON_TASK: [string, string, (t: string) => Promise<Response>][] = [
    ["edit details",       "SUBMITTED",   async t => (await import("@/app/api/tasks/[id]/details/route")).PUT(withBody("PUT", `/api/tasks/${t}/details`, { id: t, title: "Renamed task" }), P(t))],
    ["delete",             "SUBMITTED",   async t => (await import("@/app/api/tasks/[id]/delete/route")).DELETE(new Request(url(`/api/tasks/${t}/delete`), { method: "DELETE" }), P(t))],
    ["review",             "SUBMITTED",   async t => (await import("@/app/api/tasks/[id]/review/route")).POST(withBody("POST", `/api/tasks/${t}/review`, { status: "COMPLETED", difficulty: 3 }), P(t))],
    ["submit",             "SUBMITTED",   async t => (await import("@/app/api/tasks/[id]/submit/route")).PUT(withBody("PUT", `/api/tasks/${t}/submit`, { note: "done" }), P(t))],
    ["transfer",           "SUBMITTED",   async t => (await import("@/app/api/tasks/[id]/transfer/route")).POST(withBody("POST", `/api/tasks/${t}/transfer`, { newAssigneeIds: ["loner"] }), P(t))],
    ["acknowledge",        "SUBMITTED",   async t => (await import("@/app/api/tasks/[id]/acknowledge/route")).PUT(withBody("PUT", `/api/tasks/${t}/acknowledge`, {}), P(t))],
    ["record payment",     "SUBMITTED",   async t => (await import("@/app/api/tasks/[id]/payment/route")).PUT(withBody("PUT", `/api/tasks/${t}/payment`, { isPaid: true }), P(t))],
    ["apply a penalty",    "SUBMITTED",   async t => (await import("@/app/api/tasks/[id]/penalty/route")).POST(withBody("POST", `/api/tasks/${t}/penalty`, { userId: ASSIGNEE[t], amount: 1 }), P(t))],
    ["revert",             "COMPLETED",   async t => (await import("@/app/api/tasks/[id]/revert/route")).POST(withBody("POST", `/api/tasks/${t}/revert`, {}), P(t))],
    ["delete the assignee's note", "IN_PROGRESS", async t => (await import("@/app/api/tasks/[id]/items/route")).DELETE(withBody("DELETE", `/api/tasks/${t}/items`, { type: "SUBMISSION_NOTE", itemId: "note-1" }), P(t))],
    ["verify a location",  "IN_PROGRESS", async t => (await import("@/app/api/tasks/[id]/locations/route")).PUT(withBody("PUT", `/api/tasks/${t}/locations`, { timestamp: "loc-1", action: "VERIFY", verificationStatus: "VERIFIED" }), P(t))],
]

/**
 * Observed. Columns: Super Admin, Admin (c1), Admin of another company, Team
 * Leader (leads emp), Employee (emp).
 */
const EXPECTED: Record<string, Record<string, Row>> = {
    "t-emp": {
        "edit details":        [200, 200, 403, 200, 403],
        "delete":              [200, 200, 403, 200, 403],
        "review":              [200, 200, 403, 200, 403],
        "submit":              [200, 200, 403, 200, 200],
        "transfer":            [200, 200, 403, 200, 200],
        "acknowledge":         [200, 403, 403, 403, 200],   // only the assignee
        "record payment":      [200, 200, 403, 200, 403],
        "apply a penalty":     [200, 200, 403, 200, 403],
        "revert":              [200, 403, 403, 403, 403],   // Super Admin only
        "delete the assignee's note": [200, 200, 403, 200, 200],   // the employee wrote it
        "verify a location":   [200, 200, 403, 200, 403],
    },
    "t-loner": {
        "edit details":        [200, 200, 403, 403, 403],
        "delete":              [200, 200, 403, 403, 403],
        "review":              [200, 200, 403, 403, 403],
        "submit":              [200, 200, 403, 403, 403],
        "transfer":            [200, 200, 403, 403, 403],
        "acknowledge":         [200, 403, 403, 403, 403],
        "record payment":      [200, 200, 403, 403, 403],
        "apply a penalty":     [200, 200, 403, 403, 403],
        "revert":              [200, 403, 403, 403, 403],
        "delete the assignee's note": [200, 200, 403, 403, 403],   // not the author, not a manager
        "verify a location":   [200, 200, 403, 403, 403],
    },
    "t-admin": {
        "edit details":        [200, 200, 403, 403, 403],
        "delete":              [200, 403, 403, 403, 403],   // an Admin may not delete their own task
        "review":              [200, 403, 403, 403, 403],   // nor review it
        "submit":              [200, 200, 403, 403, 403],
        "transfer":            [200, 200, 403, 403, 403],
        "acknowledge":         [200, 200, 403, 403, 403],   // the Admin is the assignee
        "record payment":      [200, 200, 403, 403, 403],
        "apply a penalty":     [200, 200, 403, 403, 403],
        "revert":              [200, 403, 403, 403, 403],
        "delete the assignee's note": [200, 200, 403, 403, 403],   // not the author, not a manager
        "verify a location":   [200, 200, 403, 403, 403],
    },
    "t-other": {
        "edit details":        [200, 403, 200, 403, 403],
        "delete":              [200, 403, 200, 403, 403],
        "review":              [200, 403, 200, 403, 403],
        "submit":              [200, 403, 200, 403, 403],
        "transfer":            [200, 403, 403, 403, 403],   // 'loner' is not in c2
        "acknowledge":         [200, 403, 403, 403, 403],
        "record payment":      [200, 403, 200, 403, 403],
        "apply a penalty":     [200, 403, 200, 403, 403],
        "revert":              [200, 403, 403, 403, 403],
        "delete the assignee's note": [200, 403, 200, 403, 403],
        "verify a location":   [200, 403, 200, 403, 403],
    },
}

const COMPANY_WIDE: [string, () => Promise<Response>, Row][] = [
    ["listing tasks",                          async () => (await import("@/app/api/tasks/route")).GET(new Request(url("/api/tasks"))), [200, 200, 200, 200, 200]],
    ["creating a task for a team member",      create("emp"),   [201, 201, 403, 201, 403]],
    ["creating a task for a teamless employee", create("loner"), [201, 201, 403, 403, 403]],
    ["creating a task for an Admin",           create("admin"), [201, 201, 403, 403, 403]],
    ["creating a task in another company",     create("other"), [201, 403, 201, 403, 403]],
    // An empty upload: 400 means the caller got past the gate.
    ["bulk-creating tasks",                    async () => (await import("@/app/api/tasks/bulk/route")).POST(withBody("POST", "/api/tasks/bulk", { tasks: [] })), [400, 400, 400, 400, 403]],
    ["recording payment in bulk",              async () => (await import("@/app/api/tasks/payment/bulk/route")).POST(withBody("POST", "/api/tasks/payment/bulk", { taskIds: ["t-emp"] })), [200, 200, 200, 200, 403]],
    // Changed in Part B: the template lists every colleague's name, username
    // and role and the company's vendors, and is for bulk-creating tasks — it
    // now asks tasks.create. It asked nothing, so an employee could download
    // the staff list. (A Super Admin names the company; without one, 400.)
    ["downloading the task import template",   async () => (await import("@/app/api/templates/download/route")).GET(new Request(url("/api/templates/download?locale=en"))), [400, 200, 200, 200, 403]],
]

beforeEach(() => { taskState.status = "SUBMITTED" })

describe("actions on one task — recorded access", () => {
    for (const [task, byAction] of Object.entries(EXPECTED)) {
        for (const [action, status, run] of ON_TASK) {
            ORDER.forEach((actor, i) => {
                it(`${action} on ${task} as ${actor}`, async () => {
                    as(actor)
                    taskState.status = status
                    const res = await run(task)
                    expect(res.status).toBe(byAction[action][i])
                })
            })
        }
    }
})

describe("company-wide task actions — recorded access", () => {
    for (const [name, run, row] of COMPANY_WIDE) {
        ORDER.forEach((actor, i) => {
            it(`${name} as ${actor}`, async () => {
                as(actor)
                const res = await run()
                expect(res.status).toBe(row[i])
            })
        })
    }
})

void ACTOR_NAMES
