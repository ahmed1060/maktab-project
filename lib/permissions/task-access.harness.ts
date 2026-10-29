/**
 * Shared set-up for the task access record: the employee harness's people and
 * session, plus tasks. Each task is in a known company with known assignees, so
 * the company, team and "is this person an assignee" rules all have something
 * real to decide on. Access decisions in the routes, TaskService,
 * verifyResourceAccess and checkAssignees run for real.
 */

import { PEOPLE, prismaMock as basePrisma } from "./employee-access.harness"

export { state, ACTOR_NAMES, as, url, withBody, fieldsWritten, type ActorName } from "./employee-access.harness"
export { PEOPLE }

const person = (id: string) => ({ ...PEOPLE[id] })

/** The status every task fixture is in for the current request. */
export const taskState = { status: "SUBMITTED" }

/**
 * Each task carries a note by its assignee and a location they added, so
 * deleting an item and verifying a location have a real item to act on.
 */
const itemsBy = (authorId: string) => [
    { type: "SUBMISSION_NOTE", date: "note-1", authorId, text: "note" },
    { type: "LOCATION_ADDED", date: "loc-1", authorId, verificationStatus: "PENDING" },
]

export const TASKS: Record<string, any> = {
    // Assigned to an employee on the Team Leader's team.
    "t-emp":   { id: "t-emp",   companyId: "c1", assignees: [person("emp")] },
    // Assigned to an employee with no team.
    "t-loner": { id: "t-loner", companyId: "c1", assignees: [person("loner")] },
    // Assigned to the Admin.
    "t-admin": { id: "t-admin", companyId: "c1", assignees: [person("admin")] },
    // Another company's.
    "t-other": { id: "t-other", companyId: "c2", assignees: [person("other")] },
}

function taskRow(id: string) {
    const t = TASKS[id]
    if (!t) return null
    return {
        title: "Task", description: "A task to do", status: taskState.status, difficulty: 1,
        comments: itemsBy(t.assignees[0]?.id), memberCosts: {},
        totalCost: 0, isPaid: false, paymentStatus: "PENDING_PAYMENT", createdById: "admin", createdBy: "admin",
        deadline: new Date(Date.now() + 86_400_000), clientId: null, location: null,
        attachments: [],
        acknowledged: false, updatedAt: new Date(), createdAt: new Date(),
        ...t,
        assignees: t.assignees.map((a: any) => ({ ...a })),
    }
}

const task = {
    findUnique: async ({ where }: any) => taskRow(where.id),
    findFirst: async ({ where }: any) => (where?.id ? taskRow(where.id) : null),
    findMany: async () => [],
    count: async () => 0,
    update: async ({ where, data }: any) => ({ ...taskRow(where.id), ...data }),
    updateMany: async () => ({ count: 0 }),
    create: async ({ data }: any) => ({ id: "new-task", ...data, assignees: [] }),
    delete: async ({ where }: any) => taskRow(where.id),
    aggregate: async () => ({ _sum: {}, _count: 0 }),
}

/**
 * A shared location with its pin in each company, "loc-c1" and "loc-c2", for
 * a new task to be done at (CLIENTS_PLAN.md §2.3).
 */
const location = {
    findUnique: async ({ where }: any) => {
        const companyId = ({ "loc-c1": "c1", "loc-c2": "c2" } as Record<string, string>)[where.id]
        return companyId ? { id: where.id, companyId, clientId: null, name: "Head office", latitude: 30.0444, longitude: 31.2357, radiusMeters: null, archivedAt: null, client: null } : null
    },
}

export const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "task") return task
        if (prop === "location") return location
        if (prop === "$transaction") return async (fn: any) => typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
        // Bulk payment locks the tasks it pays first; there are no rows here to hold.
        if (prop === "$queryRaw") return async () => []
        return basePrisma[prop]
    },
})
