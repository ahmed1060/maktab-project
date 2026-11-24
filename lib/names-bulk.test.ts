import { describe, it, expect, vi, beforeEach } from "vitest"
import { Workbook } from "exceljs"
import { state, prismaMock, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"

/**
 * The bulk upload's template and file with each person and client in the
 * page's language (LATER_CHANGES_PLAN.md §3.1, step 8c; PR 414): the
 * template lists its people and clients in the language it's downloaded in,
 * in that language's order, and each location's client in it; and a file's
 * client is found by its English or its Arabic name.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/storage", () => ({ downloadTemplateBuffer: async () => Buffer.from("base") }))
const written: { users: unknown[]; clients: unknown[]; locations: unknown[] }[] = []
// The real template, with what the download hands it kept; the download's
// own base file is a stand-in, so it isn't built for it.
vi.mock("@/lib/services/template-generator.service", async importOriginal => {
    const real = await importOriginal<typeof import("@/lib/services/template-generator.service")>()
    return {
        ...real,
        generateBulkTaskTemplate: async (...args: Parameters<typeof real.generateBulkTaskTemplate>) => {
            if (args[0].toString() === "base") {
                written.push({ users: args[2], clients: args[3], locations: args[4] ?? [] })
                return Buffer.from("xlsx")
            }
            return real.generateBulkTaskTemplate(...args)
        },
    }
})

const { generateBulkTaskTemplate } = await import("@/lib/services/template-generator.service")
const { readRows } = await import("@/lib/bulk-tasks")

// Made-up people, clients and places.
const HANA = { firstName: "Hana", lastName: "Saad", firstNameAr: "هناء", lastNameAr: "سعد", username: "hana", role: "EMPLOYEE" }
const BOB = { firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null, username: "bob", role: "EMPLOYEE" }
const ADAM = { firstName: "Adam", lastName: "Nour", firstNameAr: "آدم", lastNameAr: "نور", username: "adam", role: "EMPLOYEE" }
const NOOR = { id: "k1", name: "Al Noor Trading", nameAr: "النور للتجارة", locationName: "Maadi" }
const BETA = { id: "k2", name: "Beta Supplies", nameAr: null, locationName: "Giza" }
const ACME = { id: "k3", name: "Acme Foods", nameAr: null, locationName: "Nasr City" }

async function baseFile(): Promise<Buffer> {
    const wb = new Workbook()
    const ws = wb.addWorksheet("Tasks")
    ws.addRow(["Title", "Description", "Client Name", "Employee Name", "Deadline Date", "Deadline Time", "Difficulty"])
    ws.addRow(["(instructions)"])
    return Buffer.from(await wb.xlsx.writeBuffer())
}
async function generated(locale: "en" | "ar") {
    // As the server gives them, by their English.
    const out = await generateBulkTaskTemplate(await baseFile(), locale, [ADAM, BOB, HANA], [ACME, NOOR, BETA], [])
    const wb = new Workbook()
    await wb.xlsx.load(out as any)
    return wb
}
const column = (wb: Workbook, sheet: string, rows: number) => Array.from({ length: rows }, (_, i) => wb.getWorksheet(sheet)!.getCell(`A${i + 2}`).value)

describe("the template", () => {
    it("lists its people in the language it's downloaded in, by username, in that language's order", async () => {
        expect(column(await generated("ar"), "المستخدمين", 3)).toEqual(["آدم نور (adam)", "هناء سعد (hana)", "Bob Brown (bob)"])
        expect(column(await generated("en"), "Users", 3)).toEqual(["Adam Nour (adam)", "Bob Brown (bob)", "Hana Saad (hana)"])
    })

    it("lists its clients in that language, in that language's order", async () => {
        expect(column(await generated("ar"), "العملاء", 3)).toEqual(["النور للتجارة", "Acme Foods", "Beta Supplies"])
        expect(column(await generated("en"), "Clients", 3)).toEqual(["Acme Foods", "Al Noor Trading", "Beta Supplies"])
    })
})

describe("the template's download", () => {
    const asked: Record<string, unknown> = {}
    beforeEach(() => {
        written.length = 0
        prismaMock.user.findMany = async (query: unknown) => { asked.users = query; return [] }
        prismaMock.client.findMany = async (query: unknown) => { asked.clients = query; return [] }
        prismaMock.location.findMany = async (query: unknown) => {
            asked.locations = query
            return [{ id: "l1", name: "Maadi branch", client: { name: NOOR.name, nameAr: NOOR.nameAr } }, { id: "l2", name: "Port gate", client: null }]
        }
    })
    const download = async (locale: "en" | "ar") => {
        state.session = { user: stepUpConfirmed({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.ADMIN as any) }) }
        return (await import("@/app/api/templates/download/route")).GET(new Request(url(`/api/templates/download?locale=${locale}`)))
    }

    it("asks for each person's and each client's Arabic", async () => {
        expect((await download("en")).status).toBe(200)
        expect(asked.users).toMatchObject({ select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true, username: true, role: true } })
        expect(asked.clients).toMatchObject({ select: { name: true, nameAr: true, locationName: true } })
        expect(asked.locations).toMatchObject({ select: { id: true, name: true, client: { select: { name: true, nameAr: true } } } })
    })

    it("names each location's client in the language it's downloaded in", async () => {
        await download("ar")
        expect(written[0].locations).toEqual([{ id: "l1", label: "النور للتجارة - Maadi branch", client: "النور للتجارة" }, { id: "l2", label: "Port gate", client: null }])
        await download("en")
        expect(written[1].locations).toEqual([{ id: "l1", label: "Al Noor Trading - Maadi branch", client: "Al Noor Trading" }, { id: "l2", label: "Port gate", client: null }])
    })
})

describe("a file's rows", () => {
    const row = (client: string) => ({ line: 3, cells: ["Count the stock", "Count what is on the shelves.", client, "hana", "", "", 1, ""] })
    const read = (client: string) => {
        const result = readRows([row(client)], { people: [{ id: "u1", username: "hana" }], clients: [NOOR, BETA], sheet: new Map(), places: [] })
        if (!("rows" in result)) throw new Error("no rows")
        return result.rows[0]
    }

    it("find their client by its Arabic name, as an Arabic template lists it", () => {
        expect(read("النور للتجارة")).toMatchObject({ clientId: "k1", unknownClient: "" })
    })

    it("and by its English, any case, as before", () => {
        expect(read("al noor trading")).toMatchObject({ clientId: "k1", unknownClient: "" })
        expect(read("Beta Supplies")).toMatchObject({ clientId: "k2", unknownClient: "" })
    })

    it("and say so when no client has the name in either language", () => {
        expect(read("Gamma Foods")).toMatchObject({ clientId: null, unknownClient: "Gamma Foods" })
    })
})
