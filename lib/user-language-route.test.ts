import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Saving one's language (`POST /api/user/language`, the language switch):
 * a request with no body, or an empty one, is a 400 saying the language
 * isn't one, as a body without a language is, not a 500 from reading a
 * field of nothing (the owner's answer of 2026-11-20, PR 341).
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
const saved: string[] = []
vi.mock("@/lib/services/user.service", () => ({ UserService: { updateLanguage: async (id: string, language: string) => { saved.push(`${id}:${language}`) } } }))

beforeEach(() => {
    saved.length = 0
    state.session = {
        user: { id: "emp", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.EMPLOYEE as any), featureAccess: serializeAccess(resolveBundles(null, { isSuperAdmin: false })) },
    }
})

const post = async (init: RequestInit) => (await import("@/app/api/user/language/route")).POST(new Request(url("/api/user/language"), { method: "POST", ...init }))
const json = { "Content-Type": "application/json" }

describe("saving one's language", () => {
    it("is a 400, Invalid language, with no body at all", async () => {
        const res = await post({})
        expect(res.status).toBe(400)
        expect((await res.json()).error).toBe("Invalid language")
        expect(saved).toEqual([])
    })

    it("is a 400, Invalid language, with an empty JSON body", async () => {
        const res = await post({ headers: json, body: "" })
        expect(res.status).toBe(400)
        expect((await res.json()).error).toBe("Invalid language")
        expect(saved).toEqual([])
    })

    it("is a 400 for a body without a language, or with one that isn't English or Arabic", async () => {
        for (const body of [{}, { language: "fr" }, { language: 5 }]) {
            const res = await post({ headers: json, body: JSON.stringify(body) })
            expect(res.status, JSON.stringify(body)).toBe(400)
        }
        expect(saved).toEqual([])
    })

    it("saves English or Arabic", async () => {
        expect((await post({ headers: json, body: JSON.stringify({ language: "ar" }) })).status).toBe(200)
        expect(saved).toEqual(["emp:ar"])
    })
})
