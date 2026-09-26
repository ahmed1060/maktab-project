/**
 * Shared set-up for the request access record: the employee harness's people
 * and session, plus internal requests and profile (name-change) requests —
 * each raised by a known person in a known company, so the company, team and
 * "is it yours" rules have something real to decide on. Access decisions in
 * the routes, RequestService, ProfileService and UserService run for real.
 */

import { prismaMock as basePrisma } from "./employee-access.harness"

export { state, ACTOR_NAMES, as, url, withBody, type ActorName } from "./employee-access.harness"

/** The status every request fixture is in for the current call. */
export const requestState = { status: "PENDING" }

/** Internal requests, by who raised them. */
export const REQUESTS: Record<string, { userId: string; companyId: string }> = {
    "r-emp":   { userId: "emp",   companyId: "c1" },   // on the Team Leader's team
    "r-loner": { userId: "loner", companyId: "c1" },   // teamless
    "r-admin": { userId: "admin", companyId: "c1" },   // the Admin's own
    "r-other": { userId: "other", companyId: "c2" },   // another company
}

const requestRow = (id: string) => {
    const r = REQUESTS[id]
    return r ? { id, title: "A request", details: "Some details here", status: requestState.status, createdAt: new Date(), ...r, user: { id: r.userId, firstName: "X", lastName: "Y" } } : null
}

const profileRow = (id: string) => {
    const userId = ({ "p-emp": "emp", "p-other": "other" } as Record<string, string>)[id]
    return userId ? { id, userId, status: "PENDING", oldFirstName: "A", oldLastName: "B", newFirstName: "C", newLastName: "D" } : null
}

const model = (row: (id: string) => any) => ({
    findUnique: async ({ where }: any) => row(where.id),
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    create: async ({ data }: any) => ({ id: "new", ...data }),
    update: async ({ where, data }: any) => ({ ...row(where.id), ...data }),
    delete: async ({ where }: any) => row(where.id),
})

const request = model(requestRow)
const profileUpdateRequest = model(profileRow)

export const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "request") return request
        if (prop === "profileUpdateRequest") return profileUpdateRequest
        if (prop === "$transaction") return async (fn: any) => typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
        return basePrisma[prop]
    },
})
