import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, as, url, withBody, type ActorName } from "./client-access.harness"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Who may do what with clients, vendors and costs today — recorded, not
 * reasoned about.
 *
 * Clients carry sections and notes, and the three are not guarded alike: every
 * employee may add a client, a section or a note and edit any note; renaming a
 * client or a section is for Admins and Team Leaders; deleting anything is for
 * Admins. Vendors are read by Admins and Team Leaders (a leader picks one when
 * creating a task) and managed by Admins. A person's cost history is theirs to
 * see, and an Admin's. The real routes and services run as every kind of
 * caller, against records in their own company and another. Every value was
 * observed by running the code and checked against a reading of it.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

type Row = [superAdmin: number, admin: number, otherAdmin: number, leader: number, employee: number]
const ORDER: ActorName[] = ["superAdmin", "admin", "otherAdmin", "leader", "employee"]

const clients = () => import("@/app/api/clients/route")
const sections = () => import("@/app/api/clients/[id]/sections/route")
const notes = () => import("@/app/api/clients/[id]/sections/[sectionId]/notes/route")
const vendors = () => import("@/app/api/vendors/route")
const costs = () => import("@/app/api/users/[id]/costs-history/route")
const P = (params: Record<string, string>) => ({ params })
const DEL = (p: string) => new Request(url(p), { method: "DELETE" })

/** The fixtures in each company: client, its section, the section's note, a vendor. */
const IN_COMPANY = {
    c1: { client: "cl-1", section: "s-1", note: "n-1", vendor: "v-1" },
    c2: { client: "cl-2", section: "s-2", note: "n-2", vendor: "v-2" },
}
type Fixture = typeof IN_COMPANY.c1

const ON_RECORD: [string, (f: Fixture) => Promise<Response>][] = [
    ["view a client",     async f => (await clients()).GET(new Request(url(`/api/clients?id=${f.client}`)), P({}))],
    ["rename a client",   async f => (await clients()).PUT(withBody("PUT", "/api/clients", { id: f.client, name: "Renamed" }), P({}))],
    ["delete a client",   async f => (await clients()).DELETE(DEL(`/api/clients?id=${f.client}`), P({}))],
    ["list sections",     async f => (await sections()).GET(new Request(url(`/api/clients/${f.client}/sections`)), P({ id: f.client }))],
    ["add a section",     async f => (await sections()).POST(withBody("POST", `/api/clients/${f.client}/sections`, { title: "New section" }), P({ id: f.client }))],
    ["rename a section",  async f => (await sections()).PUT(withBody("PUT", `/api/clients/${f.client}/sections`, { id: f.section, title: "Renamed" }), P({ id: f.client }))],
    ["delete a section",  async f => (await sections()).DELETE(DEL(`/api/clients/${f.client}/sections?sectionId=${f.section}`), P({ id: f.client }))],
    ["list notes",        async f => (await notes()).GET(new Request(url(`/api/clients/${f.client}/sections/${f.section}/notes`)), P({ id: f.client, sectionId: f.section }))],
    ["add a note",        async f => (await notes()).POST(withBody("POST", `/api/clients/${f.client}/sections/${f.section}/notes`, { content: "Hello" }), P({ id: f.client, sectionId: f.section }))],
    ["edit a note",       async f => (await notes()).PUT(withBody("PUT", `/api/clients/${f.client}/sections/${f.section}/notes`, { noteId: f.note, content: "Edited" }), P({ id: f.client, sectionId: f.section }))],
    ["delete a note",     async f => (await notes()).DELETE(DEL(`/api/clients/${f.client}/sections/${f.section}/notes?id=${f.note}`), P({ id: f.client, sectionId: f.section }))],
    ["view a vendor",     async f => (await vendors()).GET(new Request(url(`/api/vendors?id=${f.vendor}`)), P({}))],
    ["edit a vendor",     async f => (await vendors()).PUT(withBody("PUT", "/api/vendors", { id: f.vendor, name: "Renamed" }), P({}))],
    ["delete a vendor",   async f => (await vendors()).DELETE(DEL(`/api/vendors?id=${f.vendor}`), P({}))],
]

/** Observed. Columns: Super Admin, Admin (c1), Admin (c2), Team Leader (c1), Employee (c1). */
const EXPECTED: Record<keyof typeof IN_COMPANY, Record<string, Row>> = {
    c1: {
        "view a client":    [200, 200, 403, 200, 200],
        "rename a client":  [200, 200, 403, 200, 403],
        "delete a client":  [200, 200, 403, 403, 403],
        "list sections":    [200, 200, 404, 200, 200],   // another company's client is hidden, not refused
        "add a section":    [201, 201, 403, 201, 201],
        "rename a section": [200, 200, 403, 200, 403],
        "delete a section": [200, 200, 403, 403, 403],
        "list notes":       [200, 200, 403, 200, 200],
        "add a note":       [201, 201, 403, 201, 201],
        "edit a note":      [200, 200, 403, 200, 200],   // any note, not only one's own
        "delete a note":    [200, 200, 403, 403, 403],
        "view a vendor":    [200, 200, 403, 200, 403],
        "edit a vendor":    [200, 200, 403, 403, 403],
        "delete a vendor":  [200, 200, 403, 403, 403],
    },
    c2: {
        "view a client":    [200, 403, 200, 403, 403],
        "rename a client":  [200, 403, 200, 403, 403],
        "delete a client":  [200, 403, 200, 403, 403],
        "list sections":    [200, 404, 200, 404, 404],
        "add a section":    [201, 403, 201, 403, 403],
        "rename a section": [200, 403, 200, 403, 403],
        "delete a section": [200, 403, 200, 403, 403],
        "list notes":       [200, 403, 200, 403, 403],
        "add a note":       [201, 403, 201, 403, 403],
        "edit a note":      [200, 403, 200, 403, 403],
        "delete a note":    [200, 403, 200, 403, 403],
        "view a vendor":    [200, 403, 200, 403, 403],
        "edit a vendor":    [200, 403, 200, 403, 403],
        "delete a vendor":  [200, 403, 200, 403, 403],
    },
}

const costsOf = (id: string) => async () => (await costs()).GET(new Request(url(`/api/users/${id}/costs-history`)), P({ id }))

const OTHER: [string, () => Promise<Response>, Row][] = [
    // Lists are scoped to the caller's company in the query.
    ["listing clients",  async () => (await clients()).GET(new Request(url("/api/clients")), P({})), [200, 200, 200, 200, 200]],
    ["adding a client",  async () => (await clients()).POST(withBody("POST", "/api/clients", { name: "New client", companyId: "c1" }), P({})), [201, 201, 201, 201, 201]],
    ["listing vendors",  async () => (await vendors()).GET(new Request(url("/api/vendors")), P({})), [200, 200, 200, 200, 403]],
    ["adding a vendor",  async () => (await vendors()).POST(withBody("POST", "/api/vendors", { name: "V", ownerName: "O", mobileNumber: "0100000000", locationName: "Cairo", companyId: "c1" }), P({})), [201, 201, 201, 403, 403]],
    // One's own cost history is always visible; a Team Leader does not see their team's.
    ["cost history of a team member",       costsOf("emp"),   [200, 200, 403, 403, 200]],
    ["cost history of a teamless employee", costsOf("loner"), [200, 200, 403, 403, 403]],
    ["cost history of the Team Leader",     costsOf("tl"),    [200, 200, 403, 200, 403]],
    ["cost history of the Admin",           costsOf("admin"), [200, 200, 403, 403, 403]],
    ["cost history in another company",     costsOf("other"), [200, 403, 200, 403, 403]],
]

describe("clients, sections, notes and vendors — recorded access", () => {
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

describe("client and vendor lists, adding, and cost history — recorded access", () => {
    for (const [label, run, row] of OTHER) {
        ORDER.forEach((actor, i) => {
            it(`${label} as ${actor}`, async () => {
                as(actor)
                expect((await run()).status).toBe(row[i])
            })
        })
    }
})
