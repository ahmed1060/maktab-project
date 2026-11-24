import { describe, it, expect, vi, beforeEach } from "vitest"
import { encodeGrants } from "@/lib/permissions/grants"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { serializeAccess, resolveBundles } from "@/lib/features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * A client's names, in both languages (LATER_CHANGES_PLAN.md §3.1, step 6a,
 * PR 406; DESIGN.md §5.3): POST /api/clients takes its name and its owner's
 * each in English and in Arabic, both needed, each in its own letters, its
 * own up to 100 characters and its owner's up to 60, whatever sends them.
 * PUT /api/clients takes a name's English only in English letters with its
 * Arabic, sent with it or kept, as an employee's (PR 403); its Arabic alone
 * may be added. The client's form checks the same before it sends
 * (lib/client-form.ts), and says what the server refuses under its field.
 */

const state = { session: null as any, created: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[] }
/** A client saved before in English only, and one with both. */
const CLIENTS: Record<string, Record<string, unknown>> = {
    k1: { id: "k1", companyId: "c1", name: "Delta Sites", nameAr: null, ownerName: "Sara Mahmoud", ownerNameAr: null },
    k2: { id: "k2", companyId: "c1", name: "El Nour Trading", nameAr: "النور للتجارة", ownerName: "Mahmoud Ali", ownerNameAr: "محمود علي" },
}
const prismaMock: any = {
    client: {
        findUnique: async ({ where }: any) => CLIENTS[where.id] ?? null,
        findUniqueOrThrow: async ({ where }: any) => CLIENTS[where.id],
        create: async ({ data }: any) => { state.created.push(data); return { id: "new", ...data } },
        update: async ({ where, data }: any) => { state.updated.push(data); return { ...CLIENTS[where.id], ...data } },
    },
    rateLimit: { upsert: async () => ({ count: 1 }) },
    $transaction: async (fn: any) => fn(prismaMock),
}

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/location.service", () => ({ LocationService: { saveHq: async () => {} } }))
vi.mock("@/lib/services/name-spelling.service", () => ({ learnSpellings: async () => {} }))

beforeEach(() => {
    state.created.length = 0
    state.updated.length = 0
    state.session = {
        user: { id: "a1", role: "ADMIN", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.ADMIN as any), featureAccess: serializeAccess(resolveBundles(null, { isSuperAdmin: false })) },
    }
})

const send = async (method: "POST" | "PUT", body: Record<string, unknown>) => {
    const route = await import("@/app/api/clients/route")
    return route[method](new Request("https://nizmo.test/api/clients", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: {} } as any)
}
/** What the route says is wrong, by field. */
const refused = async (res: Response) => {
    const body = await res.json()
    return Object.fromEntries(Object.entries(body.details ?? {}).map(([field, said]: [string, any]) => [field, said?._errors?.[0]]))
}
const both = { name: "El Nour Trading", nameAr: "النور للتجارة", ownerName: "Mahmoud Ali", ownerNameAr: "محمود علي" }
const details = { mobileNumber: "01001234567", hq: { name: "HQ", latitude: 30.0444, longitude: 31.2357 } }
const add = (names: Record<string, unknown>) => send("POST", { ...names, ...details })

describe("a new client, named in both languages", () => {
    it("is added with its name and its owner's in English and in Arabic", async () => {
        expect((await add(both)).status).toBe(201)
        expect(state.created[0]).toMatchObject(both)
    })

    it("is added with each name trimmed, and not with one of spaces alone", async () => {
        expect((await add({ ...both, name: "  El Nour Trading  ", ownerNameAr: " محمود علي " })).status).toBe(201)
        expect(state.created[0]).toMatchObject({ name: "El Nour Trading", ownerNameAr: "محمود علي" })
        expect(await refused(await add({ ...both, ownerName: "   " }))).toEqual({ ownerName: "Needed in English" })
        expect(state.created).toHaveLength(1)
    })

    it("isn't added with a name in one language only", async () => {
        for (const [missing, said] of [["nameAr", "Needed in Arabic"], ["ownerNameAr", "Needed in Arabic"], ["name", "Needed in English"], ["ownerName", "Needed in English"]]) {
            const res = await add({ ...both, [missing]: undefined })
            expect(res.status, missing).toBe(400)
            expect(await refused(res), missing).toEqual({ [missing]: said })
        }
        expect(state.created).toEqual([])
    })

    it("isn't added with a name in the other language's letters", async () => {
        expect(await refused(await add({ ...both, name: "النور للتجارة" }))).toEqual({ name: "Written in English letters" })
        expect(await refused(await add({ ...both, ownerNameAr: "Mahmoud" }))).toEqual({ ownerNameAr: "Written in Arabic letters" })
        expect(await refused(await add({ ...both, ownerName: "Mahmoud علي" }))).toEqual({ ownerName: "Written in English letters" })
        expect(state.created).toEqual([])
    })

    it("takes its own name up to 100 characters and its owner's up to 60", async () => {
        expect((await add({ ...both, name: "N".repeat(100), nameAr: "ن".repeat(100), ownerName: "M".repeat(60), ownerNameAr: "م".repeat(60) })).status).toBe(201)
        expect(await refused(await add({ ...both, name: "N".repeat(101) }))).toEqual({ name: "Too long" })
        expect(await refused(await add({ ...both, nameAr: "ن".repeat(101) }))).toEqual({ nameAr: "Too long" })
        expect(await refused(await add({ ...both, ownerName: "M".repeat(61) }))).toEqual({ ownerName: "Too long" })
        expect(await refused(await add({ ...both, ownerNameAr: "م".repeat(61) }))).toEqual({ ownerNameAr: "Too long" })
        expect(state.created).toHaveLength(1)
    })
})

describe("a client's names, edited", () => {
    it("are saved with each in English and in Arabic", async () => {
        const res = await send("PUT", { id: "k1", ...both })
        expect(res.status).toBe(200)
        expect(state.updated.at(-1)).toMatchObject(both)
    })

    it("aren't saved in English with no Arabic, sent or kept", async () => {
        const name = await send("PUT", { id: "k1", name: "Delta Sites", ownerName: "Sara Mahmoud", ownerNameAr: "سارة محمود" })
        expect(name.status).toBe(400)
        expect(await refused(name)).toEqual({ nameAr: "Needed in Arabic" })
        const owner = await send("PUT", { id: "k1", name: "Delta Sites", nameAr: "دلتا سايتس", ownerName: "Sara Mahmoud" })
        expect(await refused(owner)).toEqual({ ownerNameAr: "Needed in Arabic" })
        expect(state.updated).toEqual([])
        // Kept: a client with both may have its English corrected alone.
        expect((await send("PUT", { id: "k2", name: "El Nour Trade" })).status).toBe(200)
        // Its Arabic kept: not written over.
        expect(state.updated.at(-1)).toMatchObject({ name: "El Nour Trade", nameAr: undefined })
    })

    it("aren't saved with their English in Arabic letters, or their Arabic in English ones", async () => {
        expect(await refused(await send("PUT", { id: "k2", ownerName: "محمود علي" }))).toEqual({ ownerName: "Written in English letters" })
        expect(await refused(await send("PUT", { id: "k2", name: "النور للتجارة" }))).toEqual({ name: "Written in English letters" })
        expect(await refused(await send("PUT", { id: "k2", nameAr: "El Nour" }))).toEqual({ nameAr: "Written in Arabic letters" })
        expect(state.updated).toEqual([])
    })

    it("take their Arabic alone, added", async () => {
        const res = await send("PUT", { id: "k1", nameAr: "دلتا سايتس", ownerNameAr: "سارة محمود" })
        expect(res.status).toBe(200)
        expect(state.updated.at(-1)).toMatchObject({ nameAr: "دلتا سايتس", ownerNameAr: "سارة محمود" })
    })

    it("take its owner's up to 60 characters, and its own up to 100", async () => {
        expect(await refused(await send("PUT", { id: "k2", ownerName: "M".repeat(61) }))).toEqual({ ownerName: "Too long" })
        expect(await refused(await send("PUT", { id: "k2", ownerNameAr: "م".repeat(61) }))).toEqual({ ownerNameAr: "Too long" })
        expect(await refused(await send("PUT", { id: "k2", name: "N".repeat(101) }))).toEqual({ name: "Too long" })
        expect(state.updated).toEqual([])
    })

    it("are left as they are by an edit that sends no name", async () => {
        const res = await send("PUT", { id: "k1", mobileNumber: "01009876543" })
        expect(res.status).toBe(200)
        expect(state.updated.at(-1)).toMatchObject({ name: undefined, ownerName: undefined, nameAr: undefined, ownerNameAr: undefined })
    })
})
