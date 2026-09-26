/**
 * Shared set-up for the field access record: the employee harness's people and
 * session, plus one task shared by two employees — one on the Team Leader's
 * team and one teamless — with a different payment for each. It is the
 * smallest case where "what am I paid" and "what is my colleague paid" are
 * different answers.
 */

import { prismaMock as basePrisma, PEOPLE } from "./employee-access.harness"

export { state, PEOPLE, as, url, withBody, type ActorName } from "./employee-access.harness"

export const SHARED_COSTS = { emp: 100, loner: 250 }

const person = (id: string) => ({ ...PEOPLE[id], name: `${PEOPLE[id].firstName} ${PEOPLE[id].lastName}` })

const sharedTask = () => ({
    id: "t-shared", companyId: "c1", title: "Shared", description: "Two people, two payments",
    status: "IN_PROGRESS", difficulty: 1, comments: [], attachments: [], location: null,
    memberCosts: { ...SHARED_COSTS }, memberPaymentStatus: {}, totalCost: 350,
    paymentStatus: "PENDING_PAYMENT", createdById: "admin", createdBy: "admin", vendorId: null,
    deadline: new Date(Date.now() + 86_400_000), updatedAt: new Date(), createdAt: new Date(),
    company: { autoVerifyLocation: false },
    assignees: [person("emp"), person("loner")],
})

const task = {
    findUnique: async ({ where }: any) => (where.id === "t-shared" ? sharedTask() : null),
    findFirst: async () => null,
    findMany: async () => [sharedTask()],
    count: async () => 1,
    update: async ({ data }: any) => ({ ...sharedTask(), ...data }),
    updateMany: async () => ({ count: 0 }),
    aggregate: async () => ({ _sum: {}, _count: 0 }),
}

export const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "task") return task
        if (prop === "$transaction") return async (fn: any) => typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
        return basePrisma[prop]
    },
})
