/**
 * Shared set-up for the obligation access record: the employee harness's
 * people and session, plus obligations — each in a known company with known
 * assignees, so the company, team and "is this person an assignee" rules have
 * something real to decide on. Access decisions in the routes,
 * ObligationService, verifyResourceAccess and checkAssignees run for real.
 */

import { PEOPLE, prismaMock as basePrisma } from "./employee-access.harness"

export { state, ACTOR_NAMES, as, url, withBody, type ActorName } from "./employee-access.harness"

/** The status every obligation fixture is in for the current request. */
export const obligationState = { status: "IN_PROGRESS" }

const person = (id: string) => ({ ...PEOPLE[id] })

export const OBLIGATIONS: Record<string, any> = {
    "o-emp":   { id: "o-emp",   companyId: "c1", assignees: [person("emp")] },     // on the Team Leader's team
    "o-loner": { id: "o-loner", companyId: "c1", assignees: [person("loner")] },   // teamless
    "o-admin": { id: "o-admin", companyId: "c1", assignees: [person("admin")] },   // the Admin's own
    "o-other": { id: "o-other", companyId: "c2", assignees: [person("other")] },   // another company
}

function row(id: string) {
    const o = OBLIGATIONS[id]
    if (!o) return null
    return {
        title: "Obligation", description: "Something recurring", status: obligationState.status,
        recurrence: "ONE_TIME", difficulty: 1, deadline: new Date(Date.now() + 86_400_000),
        attachments: [], createdById: "admin", updatedAt: new Date(), createdAt: new Date(),
        ...o,
        assignees: o.assignees.map((a: any) => ({ ...a })),
    }
}

const obligation = {
    findUnique: async ({ where }: any) => row(where.id),
    findFirst: async ({ where }: any) => (where?.id ? row(where.id) : null),
    findMany: async () => [],
    count: async () => 0,
    update: async ({ where, data }: any) => ({ ...row(where.id), ...data }),
    create: async ({ data }: any) => ({ id: "new-obligation", ...data, assignees: [] }),
    delete: async ({ where }: any) => row(where.id),
    updateMany: async () => ({ count: 0 }),
    deleteMany: async () => ({ count: 0 }),
}

export const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "obligation") return obligation
        if (prop === "$transaction") return async (fn: any) => typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
        return basePrisma[prop]
    },
})
