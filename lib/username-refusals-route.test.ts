import { describe, it, expect, vi, beforeEach } from "vitest"
import { stepUpConfirmed, withGrants } from "@/lib/permissions/test-actors"

/**
 * A username somebody else has is said as that, wherever it's set: adding a
 * Super Admin said "Email already exists" for any clash, and a Super Admin
 * changing somebody's username got a 500.
 */

const session = { value: null as any }
const thrown = { value: null as unknown }
vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/super-admin.service", () => ({ SuperAdminService: { create: async () => { throw thrown.value } } }))
vi.mock("@/lib/services/user.service", () => ({ UserService: { update: async () => { throw thrown.value } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const send = (method: string, path: string, body: unknown) => new Request(`https://nizmo.test${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const unique = (field: string) => Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: [field] } })
const answer = async (res: Response) => [res.status, (await res.json()).error]

describe("a username somebody else has", () => {
    beforeEach(() => { session.value = { user: stepUpConfirmed(withGrants({ id: "sa1", role: "SUPER_ADMIN" })) } })

    it("is said as that when a Super Admin is added, and an email somebody has as that", async () => {
        const { POST } = await import("@/app/api/super-admins/route")
        const admin = { firstName: "D", lastName: "S", email: "d@z.co", password: "a-long-password-123" }
        thrown.value = new Error("USERNAME_IN_USE")
        expect(await answer(await POST(send("POST", "/api/super-admins", admin)))).toEqual([400, "Username in use"])
        thrown.value = new Error("USERNAME_RESERVED")
        expect(await answer(await POST(send("POST", "/api/super-admins", admin)))).toEqual([400, "Username follows another company's username code"])
        thrown.value = unique("username")
        expect(await answer(await POST(send("POST", "/api/super-admins", admin)))).toEqual([400, "Username in use"])
        thrown.value = unique("email")
        expect(await answer(await POST(send("POST", "/api/super-admins", admin)))).toEqual([400, "Email already exists"])
    })

    it("is said as that when a Super Admin changes somebody's username", async () => {
        const { PUT } = await import("@/app/api/users/route")
        thrown.value = new Error("USERNAME_IN_USE")
        expect(await answer(await PUT(send("PUT", "/api/users", { id: "e1", username: "ops" })))).toEqual([400, "Username in use"])
    })

    // It escaped as a 500, shown as the app failing (a person's profile, part 3, PR 193).
    it("and an email somebody else has, when a person's is changed, as that", async () => {
        const { PUT } = await import("@/app/api/users/route")
        thrown.value = new Error("EMAIL_IN_USE")
        expect(await answer(await PUT(send("PUT", "/api/users", { id: "e1", email: "e2@x.co" })))).toEqual([400, "Email in use"])
    })
})
