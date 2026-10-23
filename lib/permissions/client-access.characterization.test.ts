import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, as, url, withBody, type ActorName } from "./client-access.harness"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Who may do what with records, clients and costs today — recorded, not
 * reasoned about.
 *
 * Records are what the old Clients section kept for each of its own
 * businesses, moved onto each client (CLIENTS_PLAN.md §0.2), and the same
 * people may do the same things with them: every employee may add a section
 * or a record and edit any record; renaming a section is for Admins and Team
 * Leaders; deleting anything is for Admins. Another company's are not found,
 * whatever is asked of them. Clients are read by Admins and Team Leaders (a
 * leader picks one when creating a task) and managed by Admins. A person's
 * cost history is theirs to see, and an Admin's. The real routes and services
 * run as every kind of caller, against records in their own company and
 * another. Every value was observed by running the code and checked against
 * a reading of it.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

type Row = [superAdmin: number, admin: number, otherAdmin: number, leader: number, employee: number]
const ORDER: ActorName[] = ["superAdmin", "admin", "otherAdmin", "leader", "employee"]

const records = () => import("@/app/api/records/route")
const sections = () => import("@/app/api/records/sections/route")
const uploads = () => import("@/app/api/records/uploads/route")
const recordClients = () => import("@/app/api/records/clients/route")
const clientsApi = () => import("@/app/api/clients/route")
const costs = () => import("@/app/api/users/[id]/costs-history/route")
const P = (params: Record<string, string>) => ({ params })
const DEL = (p: string) => new Request(url(p), { method: "DELETE" })

/** The fixtures in each company: a client, its section, the section's record. */
const IN_COMPANY = {
    c1: { client: "v-1", section: "s-1", record: "r-1" },
    c2: { client: "v-2", section: "s-2", record: "r-2" },
}
type Fixture = typeof IN_COMPANY.c1

const ON_RECORD: [string, (f: Fixture) => Promise<Response>][] = [
    ["list sections",             async f => (await sections()).GET(new Request(url(`/api/records/sections?clientId=${f.client}`)), P({}))],
    ["add a section",             async f => (await sections()).POST(withBody("POST", "/api/records/sections", { clientId: f.client, title: "New section" }), P({}))],
    ["rename a section",          async f => (await sections()).PUT(withBody("PUT", "/api/records/sections", { id: f.section, title: "Renamed" }), P({}))],
    ["delete a section",          async f => (await sections()).DELETE(DEL(`/api/records/sections?id=${f.section}`), P({}))],
    ["list a client's records",   async f => (await records()).GET(new Request(url(`/api/records?clientId=${f.client}`)), P({}))],
    ["open a record",             async f => (await records()).GET(new Request(url(`/api/records?id=${f.record}`)), P({}))],
    ["add a record",              async f => (await records()).POST(withBody("POST", "/api/records", { sectionId: f.section, content: "Hello" }), P({}))],
    ["add a record, new section", async f => (await records()).POST(withBody("POST", "/api/records", { clientId: f.client, sectionTitle: "Licences", content: "Hello" }), P({}))],
    ["edit a record",             async f => (await records()).PUT(withBody("PUT", "/api/records", { id: f.record, content: "Edited", filesBefore: [] }), P({}))],
    ["delete a record",           async f => (await records()).DELETE(DEL(`/api/records?id=${f.record}`), P({}))],
    ["view a client",             async f => (await clientsApi()).GET(new Request(url(`/api/clients?id=${f.client}`)), P({}))],
    ["edit a client",             async f => (await clientsApi()).PUT(withBody("PUT", "/api/clients", { id: f.client, name: "Renamed" }), P({}))],
    ["delete a client",           async f => (await clientsApi()).DELETE(DEL(`/api/clients?id=${f.client}`), P({}))],
]

/** Observed. Columns: Super Admin, Admin (c1), Admin (c2), Team Leader (c1), Employee (c1). */
const EXPECTED: Record<keyof typeof IN_COMPANY, Record<string, Row>> = {
    c1: {
        "list sections":             [200, 200, 404, 200, 200],   // another company's is hidden, not refused
        "add a section":             [201, 201, 404, 201, 201],
        "rename a section":          [200, 200, 404, 200, 403],
        "delete a section":          [200, 200, 404, 403, 403],
        "list a client's records":   [200, 200, 200, 200, 200],   // another company's client lists nothing
        "open a record":             [200, 200, 404, 200, 200],
        "add a record":              [201, 201, 404, 201, 201],
        "add a record, new section": [201, 201, 404, 201, 201],
        "edit a record":             [200, 200, 404, 200, 200],   // any record, not only one's own
        "delete a record":           [200, 200, 404, 403, 403],
        "view a client":             [200, 200, 403, 200, 403],
        "edit a client":             [200, 200, 403, 403, 403],
        "delete a client":           [200, 200, 403, 403, 403],
    },
    c2: {
        "list sections":             [200, 404, 200, 404, 404],
        "add a section":             [201, 404, 201, 404, 404],
        // Without the permission at all, refused before the record is looked
        // up, so the answer says nothing about whether it's there.
        "rename a section":          [200, 404, 200, 404, 403],
        "delete a section":          [200, 404, 200, 403, 403],
        "list a client's records":   [200, 200, 200, 200, 200],
        "open a record":             [200, 404, 200, 404, 404],
        "add a record":              [201, 404, 201, 404, 404],
        "add a record, new section": [201, 404, 201, 404, 404],
        "edit a record":             [200, 404, 200, 404, 404],
        "delete a record":           [200, 404, 200, 403, 403],
        "view a client":             [200, 403, 200, 403, 403],
        "edit a client":             [200, 403, 200, 403, 403],
        "delete a client":           [200, 403, 200, 403, 403],
    },
}

const costsOf = (id: string) => async () => (await costs()).GET(new Request(url(`/api/users/${id}/costs-history`)), P({ id }))

const OTHER: [string, () => Promise<Response>, Row][] = [
    // Lists are scoped to the caller's company in the query.
    ["listing every record", async () => (await records()).GET(new Request(url("/api/records")), P({})), [200, 200, 200, 200, 200]],
    ["listing expiring records", async () => (await records()).GET(new Request(url("/api/records?expiry=soon")), P({})), [200, 200, 200, 200, 200]],
    // Every holder of records.contribute may pick a client to add a record to, from their own company's.
    ["listing clients to add a record to", async () => (await recordClients()).GET(new Request(url("/api/records/clients")), P({})), [200, 200, 200, 200, 200]],
    // Every holder of records.contribute may discard what they uploaded; RecordService picks which files may go.
    ["discarding files uploaded for an unsaved record", async () => (await uploads()).DELETE(withBody("DELETE", "/api/records/uploads", { urls: ["https://abc.supabase.co/storage/v1/object/public/app-assets/c1/records/1-a.pdf"] }), P({})), [200, 200, 200, 200, 200]],
    ["listing clients",  async () => (await clientsApi()).GET(new Request(url("/api/clients")), P({})), [200, 200, 200, 200, 403]],
    ["adding a client",  async () => (await clientsApi()).POST(withBody("POST", "/api/clients", { name: "V", ownerName: "O", mobileNumber: "0100000000", locationName: "Cairo", companyId: "c1" }), P({})), [201, 201, 201, 403, 403]],
    // One's own cost history is always visible; a Team Leader does not see their team's.
    ["cost history of a team member",       costsOf("emp"),   [200, 200, 403, 403, 200]],
    ["cost history of a teamless employee", costsOf("loner"), [200, 200, 403, 403, 403]],
    ["cost history of the Team Leader",     costsOf("tl"),    [200, 200, 403, 200, 403]],
    ["cost history of the Admin",           costsOf("admin"), [200, 200, 403, 403, 403]],
    ["cost history in another company",     costsOf("other"), [200, 403, 200, 403, 403]],
]

describe("records, their sections, and clients — recorded access", () => {
    for (const [company, fixture] of Object.entries(IN_COMPANY) as [keyof typeof IN_COMPANY, Fixture][]) {
        for (const [action, run] of ON_RECORD) {
            ORDER.forEach((actor, i) => {
                it(`${action} in ${company} as ${actor}`, async () => {
                    as(actor)
                    expect((await run(fixture)).status).toBe(EXPECTED[company][action][i])
                })
            })
        }
    }
})

describe("record and client lists, adding, and cost history — recorded access", () => {
    for (const [label, run, row] of OTHER) {
        ORDER.forEach((actor, i) => {
            it(`${label} as ${actor}`, async () => {
                as(actor)
                expect((await run()).status).toBe(row[i])
            })
        })
    }
})
