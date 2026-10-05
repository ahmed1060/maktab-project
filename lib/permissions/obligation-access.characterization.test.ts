import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, obligationState, as, url, withBody, type ActorName } from "./obligation-access.harness"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Who may do what with obligations today — recorded, not reasoned about.
 *
 * Same method as the other records: the real obligation routes,
 * ObligationService, verifyResourceAccess and checkAssignees run as every kind
 * of caller, against four obligations — one assigned to an employee on the Team
 * Leader's team, one to a teamless employee, one to the Admin, one in another
 * company. Every value was observed by running the code and checked against a
 * reading of it.
 *
 * Recorded exactly as they are, because Part A changes nobody's access:
 *
 * - (Fixed since recording: an Employee could approve their own obligation.
 *   Approving and rejecting are now managers only.)
 * - There were two delete paths with different rules: DELETE /obligations/[id]/
 *   delete was Admins only, DELETE /obligations/[id] also lets Team Leaders
 *   delete within their team. (Fixed since recording: the second path did not
 *   check the team, so a Team Leader could delete outside it. Removed in
 *   Part B: the first, which no screen called — one door, one rule.)
 * - (Fixed since recording: reassigning to someone in another company was
 *   refused with an unmapped 500; it answers 403.)
 *
 * Reassigning as an Employee answers 200 and changes nothing: assignees are only
 * changed for managers.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

type Row = [superAdmin: number, admin: number, otherAdmin: number, leader: number, employee: number]
const ORDER: ActorName[] = ["superAdmin", "admin", "otherAdmin", "leader", "employee"]
const P = (id: string) => ({ params: { id } })
const later = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const route = () => import("@/app/api/obligations/[id]/route")

const ON_OBLIGATION: [string, string, (o: string) => Promise<Response>][] = [
    ["mark completed",    "IN_PROGRESS", async o => (await route()).PUT(withBody("PUT", `/api/obligations/${o}`, { status: "COMPLETED" }), P(o))],
    ["approve",           "COMPLETED",   async o => (await route()).PUT(withBody("PUT", `/api/obligations/${o}`, { status: "APPROVED" }), P(o))],
    ["reassign",          "IN_PROGRESS", async o => (await route()).PUT(withBody("PUT", `/api/obligations/${o}`, { assigneeIds: ["loner"] }), P(o))],
    ["delete",            "IN_PROGRESS", async o => (await route()).DELETE(new Request(url(`/api/obligations/${o}`), { method: "DELETE" }), P(o))],
    ["revert",            "APPROVED",    async o => (await import("@/app/api/obligations/[id]/revert/route")).POST(withBody("POST", `/api/obligations/${o}/revert`, {}), P(o))],
]

/** Observed. Columns: Super Admin, Admin (c1), Admin (c2), Team Leader (leads emp), Employee (emp). */
const EXPECTED: Record<string, Record<string, Row>> = {
    "o-emp": {
        "mark completed":      [200, 200, 403, 200, 200],
        "approve":             [200, 200, 403, 200, 403],
        "reassign":            [200, 200, 403, 403, 200],   // leader: 'loner' is outside the team; employee: ignored
        "delete":              [200, 200, 403, 200, 403],
        "revert":              [200, 403, 403, 403, 403],   // Super Admin only
    },
    "o-loner": {
        "mark completed":      [200, 200, 403, 403, 403],
        "approve":             [200, 200, 403, 403, 403],
        "reassign":            [200, 200, 403, 403, 403],
        "delete":              [200, 200, 403, 403, 403],
        "revert":              [200, 403, 403, 403, 403],
    },
    "o-admin": {
        "mark completed":      [200, 200, 403, 403, 403],
        "approve":             [200, 403, 403, 403, 403],   // an Admin may not approve their own
        "reassign":            [200, 200, 403, 403, 403],
        "delete":              [200, 403, 403, 403, 403],   // ...nor delete it
        "revert":              [200, 403, 403, 403, 403],
    },
    "o-other": {
        "mark completed":      [200, 403, 200, 403, 403],
        "approve":             [200, 403, 200, 403, 403],
        "reassign":            [200, 403, 403, 403, 403],   // 'loner' is not in c2
        "delete":              [200, 403, 200, 403, 403],
        "revert":              [200, 403, 403, 403, 403],
    },
}

const create = (assignee: string) => async () =>
    (await import("@/app/api/obligations/route")).POST(withBody("POST", "/api/obligations", { title: "Obligation", description: "Something to do", assigneeIds: [assignee], deadline: later() }))

const COMPANY_WIDE: [string, () => Promise<Response>, Row][] = [
    ["listing obligations",                        async () => (await import("@/app/api/obligations/route")).GET(new Request(url("/api/obligations"))), [200, 200, 200, 200, 200]],
    ["creating one for a team member",             create("emp"),   [201, 201, 403, 201, 403]],
    ["creating one for a teamless employee",       create("loner"), [201, 201, 403, 403, 403]],
    ["creating one for an Admin",                  create("admin"), [201, 201, 403, 403, 403]],
    ["creating one in another company",            create("other"), [201, 403, 201, 403, 403]],
]

describe("actions on one obligation — recorded access", () => {
    for (const [obligation, byAction] of Object.entries(EXPECTED)) {
        for (const [action, status, run] of ON_OBLIGATION) {
            ORDER.forEach((actor, i) => {
                it(`${action} on ${obligation} as ${actor}`, async () => {
                    as(actor)
                    obligationState.status = status
                    expect((await run(obligation)).status).toBe(byAction[action][i])
                })
            })
        }
    }
})

describe("company-wide obligation actions — recorded access", () => {
    for (const [name, run, row] of COMPANY_WIDE) {
        ORDER.forEach((actor, i) => {
            it(`${name} as ${actor}`, async () => {
                as(actor)
                obligationState.status = "IN_PROGRESS"
                expect((await run()).status).toBe(row[i])
            })
        })
    }
})
