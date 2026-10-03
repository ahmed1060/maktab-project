import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, requestState, as, url, withBody, type ActorName } from "./request-access.harness"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Who may do what with requests today — recorded, not reasoned about.
 *
 * Covers internal requests, profile (name-change) requests, and resetting a
 * person's performance points. The real routes, RequestService, ProfileService
 * and UserService run as every kind of caller, against requests raised by an
 * employee on the Team Leader's team, a teamless employee, the Admin, and
 * someone in another company. Every value was observed by running the code and
 * checked against a reading of it.
 *
 * (Fixed since recording: the request list was limited to a Team Leader's team,
 * but viewing, changing and deleting one request checked only the company, so
 * a Team Leader could act on requests outside their team. They now follow the
 * list's team rule.)
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

type Row = [superAdmin: number, admin: number, otherAdmin: number, leader: number, employee: number]
const ORDER: ActorName[] = ["superAdmin", "admin", "otherAdmin", "leader", "employee"]
const P = (id: string) => ({ params: { id } })
const one = () => import("@/app/api/requests/[id]/route")

const ON_REQUEST: [string, string, (id: string) => Promise<Response>][] = [
    ["view",                   "PENDING",   async id => (await one()).GET(new Request(url(`/api/requests/${id}`)), P(id))],
    ["change status",          "PENDING",   async id => (await one()).PATCH(withBody("PATCH", `/api/requests/${id}`, { status: "IN_PROGRESS" }), P(id))],
    ["delete",                 "PENDING",   async id => (await one()).DELETE(new Request(url(`/api/requests/${id}`), { method: "DELETE" }), P(id))],
    ["delete a completed one", "COMPLETED", async id => (await one()).DELETE(new Request(url(`/api/requests/${id}`), { method: "DELETE" }), P(id))],
]

/** Observed. Columns: Super Admin, Admin (c1), Admin (c2), Team Leader (leads emp), Employee (emp). */
const EXPECTED: Record<string, Record<string, Row>> = {
    "r-emp": {
        "view":                   [200, 200, 403, 200, 200],   // the employee's own
        "change status":          [200, 200, 403, 200, 403],
        "delete":                 [200, 200, 403, 200, 200],   // the employee may withdraw their own
        "delete a completed one": [200, 403, 403, 403, 403],   // Super Admin only
    },
    "r-loner": {
        "view":                   [200, 200, 403, 403, 403],   // outside the leader's team
        "change status":          [200, 200, 403, 403, 403],
        "delete":                 [200, 200, 403, 403, 403],
        "delete a completed one": [200, 403, 403, 403, 403],
    },
    "r-admin": {
        "view":                   [200, 200, 403, 403, 403],
        "change status":          [200, 200, 403, 403, 403],
        "delete":                 [200, 200, 403, 403, 403],
        "delete a completed one": [200, 403, 403, 403, 403],
    },
    "r-other": {
        "view":                   [200, 403, 200, 403, 403],
        "change status":          [200, 403, 200, 403, 403],
        "delete":                 [200, 403, 200, 403, 403],
        "delete a completed one": [200, 403, 403, 403, 403],
    },
}

const name = (verb: "approve" | "reject", id: string) => async () =>
    (await import(`@/app/api/profile-requests/[id]/${verb}/route`)).POST(withBody("POST", `/api/profile-requests/${id}/${verb}`, {}), P(id))
const resetPoints = (userId: string) => async () =>
    (await import("@/app/api/users/[id]/reset-points/route")).POST(withBody("POST", `/api/users/${userId}/reset-points`, {}), P(userId))

const OTHER: [string, () => Promise<Response>, Row][] = [
    // Lists are scoped in the query; everyone may ask for theirs.
    ["listing requests",           async () => (await import("@/app/api/requests/route")).GET(new Request(url("/api/requests"))), [200, 200, 200, 200, 200]],
    ["raising a request",          async () => (await import("@/app/api/requests/route")).POST(withBody("POST", "/api/requests", { title: "Need a laptop", details: "Mine is broken again" })), [201, 201, 201, 201, 201]],
    ["listing name-change requests", async () => (await import("@/app/api/profile-requests/route")).GET(new Request(url("/api/profile-requests"))), [200, 200, 200, 200, 200]],
    // A Super Admin has no employee record to rename.
    ["asking to change your name", async () => (await import("@/app/api/profile-requests/route")).POST(withBody("POST", "/api/profile-requests", { newFirstName: "New", newLastName: "Name" })), [404, 201, 201, 201, 201]],
    ["approving a name change in the company",       name("approve", "p-emp"),   [200, 200, 403, 403, 403]],
    ["rejecting a name change in the company",       name("reject", "p-emp"),    [200, 200, 403, 403, 403]],
    ["approving a name change in another company",   name("approve", "p-other"), [200, 403, 200, 403, 403]],
    ["rejecting a name change in another company",   name("reject", "p-other"),  [200, 403, 200, 403, 403]],
    // Added in Part B: nobody decides their own name change (ROLES_PLAN.md
    // §4.2, rule 5).
    ["approving the Admin's own name change",        name("approve", "p-admin"), [200, 403, 403, 403, 403]],
    ["rejecting the Admin's own name change",        name("reject", "p-admin"),  [200, 403, 403, 403, 403]],
    ["resetting a team member's points",             resetPoints("emp"),         [200, 200, 403, 403, 403]],
    ["resetting a teamless employee's points",       resetPoints("loner"),       [200, 200, 403, 403, 403]],
    ["resetting points in another company",          resetPoints("other"),       [200, 403, 200, 403, 403]],
]

describe("actions on one request — recorded access", () => {
    for (const [request, byAction] of Object.entries(EXPECTED)) {
        for (const [action, status, run] of ON_REQUEST) {
            ORDER.forEach((actor, i) => {
                it(`${action} ${request} as ${actor}`, async () => {
                    as(actor)
                    requestState.status = status
                    expect((await run(request)).status).toBe(byAction[action][i])
                })
            })
        }
    }
})

describe("request lists, name changes and points — recorded access", () => {
    for (const [label, run, row] of OTHER) {
        ORDER.forEach((actor, i) => {
            it(`${label} as ${actor}`, async () => {
                as(actor)
                requestState.status = "PENDING"
                expect((await run()).status).toBe(row[i])
            })
        })
    }
})
