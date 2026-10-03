import { describe, it, expect, vi } from "vitest"

/**
 * Resetting the points of somebody who doesn't exist: the Super Admin passes
 * the company check for any id, so the service's USER_NOT_FOUND reached the
 * handler unmapped, a 500. Found by calling every API route with junk ids.
 */
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "sa", role: "SUPER_ADMIN" } }) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/security", async (original) => ({ ...(await original<typeof import("@/lib/security")>()), verifyResourceAccess: async () => true }))
vi.mock("@/lib/services/user.service", () => ({ UserService: { resetPoints: async () => { throw new Error("USER_NOT_FOUND") } } }))

const { POST } = await import("@/app/api/users/[id]/reset-points/route")

describe("POST /api/users/<id>/reset-points", () => {
    it("is a 404 for somebody who doesn't exist", async () => {
        const res = await POST(new Request("https://nizmo.test/api/users/nobody/reset-points", { method: "POST" }), { params: Promise.resolve({ id: "nobody" }) } as any)
        expect(res.status).toBe(404)
        expect((await res.json()).error).toBe("User not found")
    })
})
