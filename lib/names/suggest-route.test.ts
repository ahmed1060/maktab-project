import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, url } from "@/lib/permissions/employee-access.harness"
import { encodeGrants } from "@/lib/permissions/grants"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { serializeAccess, resolveBundles } from "@/lib/features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * A name's suggestion, asked of the server (`GET /api/names/suggest`,
 * LATER_CHANGES_PLAN.md §3.1, step 3b, PR 401): for whoever may use a form
 * that takes a name, which is anyone in the company, as one's own profile
 * takes one. Employees' names and the company's are anyone's to learn
 * from; clients' names and their owners' only for whoever may add or edit
 * a client. The Super Admin's are the company in view's.
 * lib/names/spellings.db.test.ts has the suggestion itself, in Postgres.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
const asked: { companyId: string | null; name: string; to: string; kind: string; sources: string[] }[] = []
vi.mock("@/lib/services/name-spelling.service", () => ({
    suggestWithSpellings: async (companyId: string | null, name: string, { to, kind }: { to: string; kind: string }, sources: string[]) => {
        asked.push({ companyId, name, to, kind, sources })
        return { text: "Mohamed", words: [{ text: "Mohamed", from: "list" }], guesses: [] }
    },
}))

const access = serializeAccess(resolveBundles(null, { isSuperAdmin: false }))
const as = (role: "ADMIN" | "TEAM_LEADER" | "EMPLOYEE", grants: Record<string, string> = BUILT_IN_GRANTS[role] as any) => ({
    user: { id: "u1", role, companyId: "c1", grants: encodeGrants(grants as any), featureAccess: access },
})

beforeEach(() => {
    asked.length = 0
    state.session = as("EMPLOYEE")
})

const get = async (query: string) => (await import("@/app/api/names/suggest/route")).GET(new Request(url(`/api/names/suggest?${query}`)))
const ask = (name: string, to = "en", kind = "person", more = "") => get(`name=${encodeURIComponent(name)}&to=${to}&kind=${kind}${more}`)

describe("a name's suggestion, asked of the server", () => {
    it("is the suggestion, for the asker's company", async () => {
        const res = await ask("محمد")
        expect(res.status).toBe(200)
        expect((await res.json()).data).toEqual({ text: "Mohamed", words: [{ text: "Mohamed", from: "list" }], guesses: [] })
        expect(asked).toEqual([{ companyId: "c1", name: "محمد", to: "en", kind: "person", sources: ["employee"] }])
    })

    it("learns from employees' names and the company's for anyone, as one's own profile takes a name", async () => {
        await ask("محمد")
        await ask("النور", "en", "business")
        expect(asked.map(a => a.sources)).toEqual([["employee"], ["company"]])
        state.session = as("TEAM_LEADER")
        await ask("Mohamed", "ar")
        expect(asked.at(-1)?.sources).toEqual(["employee"])
    })

    it("learns from clients' names and their owners' too for whoever may add or edit a client", async () => {
        state.session = as("ADMIN")
        await ask("محمد")
        await ask("النور", "en", "business")
        expect(asked.map(a => a.sources)).toEqual([["employee", "owner"], ["company", "client"]])
        const either: Record<string, string>[] = [{ "clients.view": "COMPANY", "clients.create": "COMPANY" }, { "clients.view": "COMPANY", "clients.edit": "COMPANY" }]
        for (const grants of either) {
            asked.length = 0
            state.session = as("EMPLOYEE", grants)
            await ask("محمد")
            expect(asked[0].sources, JSON.stringify(grants)).toEqual(["employee", "owner"])
        }
        // Seeing clients isn't adding or editing one.
        asked.length = 0
        state.session = as("EMPLOYEE", { "clients.view": "COMPANY", "clients.delete": "COMPANY" })
        await ask("محمد")
        expect(asked[0].sources).toEqual(["employee"])
    })

    it("is the company in view's for the Super Admin, from all its names", async () => {
        state.session = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } }
        await ask("محمد", "en", "person", "&companyId=c2")
        expect(asked).toEqual([{ companyId: "c2", name: "محمد", to: "en", kind: "person", sources: ["employee", "owner"] }])
        await ask("محمد")
        expect(asked.at(-1)?.companyId).toBeNull()
    })

    it("takes no company but the asker's from anyone else", async () => {
        await ask("محمد", "en", "person", "&companyId=c2")
        expect(asked[0].companyId).toBe("c1")
    })

    it("is a 400 for a name it can't read, a language or a kind it doesn't know", async () => {
        for (const query of ["to=en&kind=person", "name=&to=en&kind=person", "name=%20%20&to=en&kind=person", `name=${"م".repeat(101)}&to=en&kind=person`, "name=x&to=fr&kind=person", "name=x&kind=person", "name=x&to=en&kind=place", "name=x&to=en"]) {
            expect((await get(query)).status, query).toBe(400)
        }
        expect(asked).toEqual([])
    })

    it("is for someone signed in only", async () => {
        state.session = null as any
        expect((await ask("محمد")).status).toBe(401)
        expect(asked).toEqual([])
    })
})
