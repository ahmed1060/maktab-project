/**
 * Shared set-up for the employee access record: one session, a permissive
 * database with fixture people, and the services an employee change calls
 * into (salary history, employment events, notifications, audit) replaced
 * with no-ops. Access decisions in the routes and in UserService run for real.
 *
 * Kept in its own module so the record file reads as the record.
 */

import { withGrants, builtInRoleLookup, stepUpConfirmed } from "./test-actors"

export const state = { session: null as any, written: [] as Record<string, unknown>[], created: [] as any[] }

export const PEOPLE: Record<string, any> = {
    admin:  { id: "admin",  companyId: "c1", role: "ADMIN",       teamLeaderId: null, status: "ACTIVE", firstName: "A", lastName: "D", email: "admin@c1",  salary: 3000, avatar: null },
    admin2: { id: "admin2", companyId: "c2", role: "ADMIN",       teamLeaderId: null, status: "ACTIVE", firstName: "B", lastName: "E", email: "admin@c2",  salary: 3000, avatar: null },
    admin1b:{ id: "admin1b",companyId: "c1", role: "ADMIN",       teamLeaderId: null, status: "ACTIVE", firstName: "C", lastName: "F", email: "admin2@c1", salary: 3000, avatar: null },
    tl:     { id: "tl",     companyId: "c1", role: "TEAM_LEADER", teamLeaderId: null, status: "ACTIVE", firstName: "T", lastName: "L", email: "tl@c1",     salary: 2000, avatar: null },
    emp:    { id: "emp",    companyId: "c1", role: "EMPLOYEE",    teamLeaderId: "tl", status: "ACTIVE", firstName: "E", lastName: "M", email: "emp@c1",    salary: 1000, avatar: null },
    loner:  { id: "loner",  companyId: "c1", role: "EMPLOYEE",    teamLeaderId: null, status: "ACTIVE", firstName: "L", lastName: "O", email: "loner@c1",  salary: 1000, avatar: null },
    other:  { id: "other",  companyId: "c2", role: "EMPLOYEE",    teamLeaderId: null, status: "ACTIVE", firstName: "O", lastName: "T", email: "other@c2",  salary: 1000, avatar: null },
}

function model(overrides: Record<string, any> = {}) {
    return {
        findUnique: async () => null,
        findFirst: async () => null,
        findMany: async () => [],
        count: async () => 0,
        aggregate: async () => ({ _sum: { daysDeducted: 0 }, _count: 0 }),
        groupBy: async () => [],
        create: async ({ data }: any) => ({ id: "new", ...data }),
        update: async ({ where, data }: any) => ({ ...where, ...data }),
        upsert: async ({ create }: any) => ({ id: "new", ...create }),
        updateMany: async () => ({ count: 0 }),
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 }),
        delete: async ({ where }: any) => ({ ...where }),
        ...overrides,
    }
}

const models: Record<string, any> = {
    // Each company's built-in roles, as the roles migration creates them.
    role: model({ findUnique: (args: any) => builtInRoleLookup(args) }),
    rateLimit: model({ upsert: async () => ({ count: 1 }) }),
    company: model({ findUnique: async ({ where }: any) => ({ id: where.id, name: where.id, isBanned: false }) }),
    user: model({
        // Each person on their company's built-in role, as the roles migration
        // put them — what the last-Admin rule reads.
        findUnique: async ({ where }: any) => {
            const p = PEOPLE[where.id]
            return p ? { ...p, roleId: `${p.companyId}:${p.role}`, assignedRole: { builtIn: p.role } } : null
        },
        count: async ({ where }: any) => Object.values(PEOPLE).filter(p =>
            (!where?.roleId || `${p.companyId}:${p.role}` === where.roleId) &&
            (!where?.status?.in || where.status.in.includes(p.status)) &&
            (!where?.id?.not || p.id !== where.id.not)
        ).length,
        findFirst: async () => null,
        findMany: async ({ where }: any) => {
            const ids: string[] | undefined = where?.id?.in
            return ids ? ids.map(id => PEOPLE[id]).filter(Boolean) : []
        },
        update: async ({ where, data }: any) => { state.written.push({ ...data }); return { ...PEOPLE[where.id], ...data } },
        updateMany: async ({ data }: any) => { state.written.push({ ...data }); return { count: 1 } },
        create: async ({ data }: any) => { state.created.push(data); return { id: "new-user", ...data } },
    }),
}

export const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "$transaction") return async (fn: any) => typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
        if (prop === "then") return undefined
        return models[prop] ??= model()
    },
})

export const ACTORS = {
    superAdmin: { id: "sa",     role: "SUPER_ADMIN", companyId: null },
    admin:      { id: "admin",  role: "ADMIN",       companyId: "c1" },
    otherAdmin: { id: "admin2", role: "ADMIN",       companyId: "c2" },
    leader:     { id: "tl",     role: "TEAM_LEADER", companyId: "c1" },
    employee:   { id: "emp",    role: "EMPLOYEE",    companyId: "c1" },
} as const
export type ActorName = keyof typeof ACTORS
export const ACTOR_NAMES = Object.keys(ACTORS) as ActorName[]

export function as(name: ActorName) {
    state.session = { user: stepUpConfirmed(withGrants({ ...ACTORS[name] })) }
    state.written = []
    state.created = []
}

export const url = (p: string) => `https://nizmo.test${p}`
export const withBody = (method: string, p: string, body: unknown) => new Request(url(p), {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
})

/** Every field any write in this request set, merged. */
export function fieldsWritten(): string[] {
    return [...new Set(state.written.flatMap(d => Object.keys(d)))].sort()
}
