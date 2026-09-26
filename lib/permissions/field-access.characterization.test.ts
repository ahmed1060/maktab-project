import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, as, url, withBody, type ActorName } from "./field-access.harness"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Which protected fields reach whom — recorded, not reasoned about.
 *
 * A route check says who may call a route; this records what the answer
 * carries. Two fields are protected today:
 *
 * - A person's salary, on GET /api/users?id=. Everyone sees their own; beyond
 *   that it needs salary.view, which an Admin holds for their company and a
 *   Team Leader does not hold at all.
 * - What each assignee is paid for a task (memberCosts), on the task routes an
 *   employee can reach: the list, and the response to submitting their work.
 *
 * Driven through the real routes as every kind of caller, against a task that
 * two employees share at different rates. Observed by running the code.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const P = (id: string) => ({ params: { id } })
const ORDER: ActorName[] = ["superAdmin", "admin", "otherAdmin", "leader", "employee"]

/** "absent", or the salary as returned; null when the lookup is refused. */
async function salaryOf(who: string): Promise<number | "absent" | null> {
    const res = await (await import("@/app/api/users/route")).GET(new Request(url(`/api/users?id=${who}`)), P(""))
    if (res.status !== 200) return null
    const { data } = await res.json()
    return "salary" in data ? data.salary : "absent"
}

type Row = [superAdmin: unknown, admin: unknown, otherAdmin: unknown, leader: unknown, employee: unknown]

/** Observed. Columns: Super Admin, Admin (c1), Admin (c2), Team Leader (leads emp), Employee (emp). */
const SALARY: Record<string, Row> = {
    "an employee on the leader's team": [1000, 1000, null, "absent", 1000],   // emp: the employee's own
    "a teamless employee":              [1000, 1000, null, null, null],
    "the Team Leader":                  [2000, 2000, null, 2000, null],        // the leader's own
    "the Admin":                        [3000, 3000, null, null, null],        // the Admin's own
    "someone in another company":       [1000, null, 1000, null, null],
}
const WHO: Record<string, string> = {
    "an employee on the leader's team": "emp",
    "a teamless employee": "loner",
    "the Team Leader": "tl",
    "the Admin": "admin",
    "someone in another company": "other",
}

describe("a person's salary — recorded", () => {
    for (const [label, row] of Object.entries(SALARY)) {
        ORDER.forEach((actor, i) => {
            it(`${label}, looked up by ${actor}`, async () => {
                as(actor)
                expect(await salaryOf(WHO[label])).toEqual(row[i])
            })
        })
    }
})

const EVERYONE = { emp: 100, loner: 250 }

async function listedCosts() {
    const res = await (await import("@/app/api/tasks/route")).GET(new Request(url("/api/tasks")), P(""))
    const { data } = await res.json()
    return data.data[0].memberCosts
}
async function submittedCosts() {
    const res = await (await import("@/app/api/tasks/[id]/submit/route")).PUT(withBody("PUT", "/api/tasks/t-shared/submit", { note: "done", isDraft: true }), P("t-shared"))
    if (res.status !== 200) return null
    const { data } = await res.json()
    return data.memberCosts
}

describe("what each assignee is paid for a task — recorded", () => {
    // Recorded as it is: the employee receives their colleague's payment too.
    // The task pages narrow this before rendering; these two routes do not.
    // (The list's fixture answers every caller — which tasks each may list is
    // task-access's record; this one is about what a listed task carries.)
    const LIST: Row = [EVERYONE, EVERYONE, EVERYONE, EVERYONE, EVERYONE]
    const SUBMIT: Row = [EVERYONE, EVERYONE, null, EVERYONE, EVERYONE]

    ORDER.forEach((actor, i) => {
        it(`the task list, as ${actor}`, async () => {
            as(actor)
            expect(await listedCosts()).toEqual(LIST[i])
        })
        it(`submitting the task, as ${actor}`, async () => {
            as(actor)
            expect(await submittedCosts()).toEqual(SUBMIT[i])
        })
    })
})
