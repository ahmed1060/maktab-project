import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A Super Admin's account is not a company Admin's to edit.
 *
 * PUT /api/users looks the id up among a company's people and, failing that,
 * among the Super Admins; the company check that follows covers only the
 * first. The route lets any Admin edit, so an Admin could send a Super Admin's
 * id and rewrite their name, email or password — taking over the platform
 * account. These tests drive the real route and UserService; the database is
 * a stand-in holding one Super Admin.
 */

const session = { value: null as any }
const written: Record<string, unknown>[] = []
const SUPER_ADMIN = { id: "sa-row", firstName: "S", lastName: "A", email: "sa@nizmo.test", gender: "MALE", avatar: null, username: "sa", isProtected: false }

vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: async () => null },
        superAdmin: {
            findUnique: async ({ where }: any) => where.id === SUPER_ADMIN.id ? SUPER_ADMIN : null,
            update: async ({ data }: any) => { written.push(data); return { ...SUPER_ADMIN, ...data } },
        },
        rateLimit: { upsert: async () => ({ count: 1 }) },
    },
}))

const put = (body: unknown) => new Request("https://nizmo.test/api/users", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
})

describe("a Super Admin's account", () => {
    beforeEach(() => { written.length = 0 })

    it("is refused to a company Admin, password or otherwise", async () => {
        const { PUT } = await import("@/app/api/users/route")
        session.value = { user: { id: "admin-1", role: "ADMIN", companyId: "co-1" } }
        expect((await PUT(put({ id: SUPER_ADMIN.id, password: "a-new-password-123" }))).status).toBe(403)
        expect((await PUT(put({ id: SUPER_ADMIN.id, firstName: "Mallory" }))).status).toBe(403)
        expect(written).toEqual([])
    })

    it("is the Super Admins' to edit", async () => {
        const { PUT } = await import("@/app/api/users/route")
        session.value = { user: { id: "sa-other", role: "SUPER_ADMIN", companyId: null } }
        expect((await PUT(put({ id: SUPER_ADMIN.id, firstName: "Sam" }))).status).toBe(200)
        expect(written).toEqual([{ firstName: "Sam" }])
    })
})
