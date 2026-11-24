import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, url } from "@/lib/permissions/employee-access.harness"
import { encodeGrants } from "@/lib/permissions/grants"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { serializeAccess, resolveBundles } from "@/lib/features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Someone new, named in both languages (LATER_CHANGES_PLAN.md §3.1, step
 * 4a, PR 402; DESIGN.md §5.3): POST /api/users takes each name in English
 * and in Arabic, both needed, each in its own letters, whatever sends it.
 * Add employee checks the same before it sends (lib/new-employee-form.ts).
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
const created: Record<string, unknown>[] = []
vi.mock("@/lib/services/user.service", () => ({ UserService: { create: async (input: Record<string, unknown>) => { created.push(input); return { id: "new" } } } }))

beforeEach(() => {
    created.length = 0
    state.session = {
        user: { id: "a1", role: "ADMIN", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.ADMIN as any), featureAccess: serializeAccess(resolveBundles(null, { isSuperAdmin: false })) },
    }
})

const post = async (names: Record<string, string | undefined>) => (await import("@/app/api/users/route")).POST(new Request(url("/api/users"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...names, email: "new@example.com", password: "a-long-password-123" }),
}))
const both = { firstName: "Mostafa", firstNameAr: "مصطفى", lastName: "Hassan", lastNameAr: "حسن" }

describe("someone new, named in both languages", () => {
    it("is added with each name in English and in Arabic", async () => {
        expect((await post(both)).status).toBe(201)
        expect(created[0]).toMatchObject(both)
    })

    it("is added with each name trimmed, and not with one of spaces alone", async () => {
        expect((await post({ ...both, firstName: "  Mostafa  " })).status).toBe(201)
        expect(created[0]).toMatchObject({ firstName: "Mostafa" })
        expect((await post({ ...both, lastName: "   " })).status).toBe(400)
        expect(created).toHaveLength(1)
    })

    it("isn't added with a name in one language only", async () => {
        for (const missing of ["firstNameAr", "lastNameAr"]) {
            const res = await post({ ...both, [missing]: undefined })
            expect(res.status, missing).toBe(400)
            expect(Object.keys((await res.json()).details), missing).toContain(missing)
        }
        expect((await post({ ...both, firstName: "" })).status).toBe(400)
        expect(created).toEqual([])
    })

    it("isn't added with a name longer than the limit, and the page says so (Codex, PR 402)", async () => {
        const { refusedField } = await import("@/lib/new-employee-form")
        const english = await post({ ...both, firstName: "Mohamed Mostafa Abdelrahman Abdallah Mahmoud" })
        expect(english.status).toBe(400)
        expect(refusedField(await english.json())).toEqual({ field: "firstName", key: "name_too_long" })
        const arabic = await post({ ...both, lastNameAr: "م".repeat(41) })
        expect(refusedField(await arabic.json())).toEqual({ field: "lastNameAr", key: "name_too_long" })
        const letters = await post({ ...both, firstName: "مصطفى" })
        expect(refusedField(await letters.json())).toEqual({ field: "firstName", key: "name_not_english" })
        expect(created).toEqual([])
    })

    it("isn't added with a name in the other language's letters", async () => {
        const english = await post({ ...both, firstName: "مصطفى" })
        expect(english.status).toBe(400)
        expect(Object.keys((await english.json()).details)).toContain("firstName")
        const arabic = await post({ ...both, lastNameAr: "Hassan" })
        expect(arabic.status).toBe(400)
        expect(Object.keys((await arabic.json()).details)).toContain("lastNameAr")
        expect((await post({ ...both, lastName: "Hassan حسن" })).status).toBe(400)
        expect(created).toEqual([])
    })
})
