/**
 * Shared set-up for the clients, vendors and costs access record: the employee
 * harness's people and session, plus a client with a section and a note, and a
 * vendor, in each of two companies. Access decisions in the routes and in
 * ClientService, SectionService, NoteService, VendorService and UserService run
 * for real.
 */

import { prismaMock as basePrisma } from "./employee-access.harness"

export { state, ACTOR_NAMES, as, url, withBody, type ActorName } from "./employee-access.harness"

const clientRow = (id: string) =>
    ({ "cl-1": { id, name: "Client one", companyId: "c1" }, "cl-2": { id, name: "Client two", companyId: "c2" } } as Record<string, any>)[id] ?? null

const sectionRow = (id: string) => {
    const clientId = ({ "s-1": "cl-1", "s-2": "cl-2" } as Record<string, string>)[id]
    return clientId ? { id, title: "A section", clientId, client: { companyId: clientRow(clientId).companyId } } : null
}

const noteRow = (id: string) => {
    const sectionId = ({ "n-1": "s-1", "n-2": "s-2" } as Record<string, string>)[id]
    return sectionId ? { id, content: "A note", sectionId, attachment: null, section: sectionRow(sectionId) } : null
}

const vendorRow = (id: string) =>
    ({ "v-1": { id, name: "Vendor one", companyId: "c1" }, "v-2": { id, name: "Vendor two", companyId: "c2" } } as Record<string, any>)[id] ?? null

const model = (row: (id: string) => any) => ({
    findUnique: async ({ where }: any) => row(where.id),
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    create: async ({ data }: any) => ({ id: "new", ...data }),
    update: async ({ where, data }: any) => ({ ...row(where.id), ...data }),
    delete: async ({ where }: any) => row(where.id),
})

const models: Record<string, any> = {
    businessClient: model(clientRow),
    businessClientSection: model(sectionRow),
    businessClientNote: model(noteRow),
    vendor: model(vendorRow),
}

export const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop in models) return models[prop]
        if (prop === "$transaction") return async (fn: any) => typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
        return basePrisma[prop]
    },
})
