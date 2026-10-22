/**
 * Shared set-up for the records, clients and costs access record: the
 * employee harness's people and session, plus a client with a section of
 * records holding one record, in each of two companies. Access decisions in
 * the routes and in RecordService, ClientService and UserService run for real.
 */

import { prismaMock as basePrisma } from "./employee-access.harness"

export { state, ACTOR_NAMES, as, url, withBody, type ActorName } from "./employee-access.harness"

const clientRow = (id: string) =>
    ({ "v-1": { id, name: "Client one", companyId: "c1" }, "v-2": { id, name: "Client two", companyId: "c2" } } as Record<string, any>)[id] ?? null

const sectionRow = (id: string) => {
    const clientId = ({ "s-1": "v-1", "s-2": "v-2" } as Record<string, string>)[id]
    return clientId ? { id, title: "A section", clientId, client: { companyId: clientRow(clientId).companyId } } : null
}

const recordRow = (id: string) => {
    const sectionId = ({ "r-1": "s-1", "r-2": "s-2" } as Record<string, string>)[id]
    if (!sectionId) return null
    const section = sectionRow(sectionId)!
    return {
        id, content: "A record", sectionId, attachment: null, expiryDate: null, reminderDays: null,
        createdAt: new Date(0), lastEditedAt: null, createdBy: null, lastEditedBy: null,
        section: { ...section, client: { ...section.client, id: section.clientId, name: clientRow(section.clientId).name } },
    }
}

const model = (row: (id: string) => any) => ({
    findUnique: async ({ where }: any) => (where.id ? row(where.id) : null),
    findUniqueOrThrow: async ({ where }: any) => row(where.id),
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    create: async ({ data }: any) => ({ id: "new", ...data }),
    update: async ({ where, data }: any) => ({ ...row(where.id), ...data }),
    delete: async ({ where }: any) => row(where.id),
})

const models: Record<string, any> = {
    client: model(clientRow),
    recordSection: model(sectionRow),
    clientRecord: model(recordRow),
    removedRecordFile: { count: async () => 0, createMany: async () => ({ count: 0 }) },
}

export const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop in models) return models[prop]
        if (prop === "$transaction") return async (fn: any) => typeof fn === "function" ? fn(prismaMock) : Promise.all(fn)
        // The row locks RecordService takes on a client, a section or a record: the row, if it's there.
        if (prop === "$queryRaw") return async (sql: TemplateStringsArray, ...values: any[]) => {
            const text = sql.join("?")
            if (text.includes("pg_advisory")) return [{}]
            if (text.includes('FROM "Client"')) return clientRow(values[0]) ? [{ id: values[0] }] : []
            // The section's: by its id, or a client's section by name, which none of the fixtures is.
            if (text.includes('FROM "ClientSection" WHERE id')) return sectionRow(values[0]) ? [{ id: values[0] }] : []
            if (text.includes('FROM "ClientSection"')) return []
            if (text.includes('FROM "ClientNote" WHERE id')) return recordRow(values[0]) ? [{ id: values[0] }] : []
            if (text.includes('FROM "ClientNote"')) return []
            return basePrisma.$queryRaw(sql, ...values)
        }
        return basePrisma[prop]
    },
})
