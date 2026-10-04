import { describe, it, expect, vi } from "vitest"

/**
 * Which counter a route's rate limit uses. One with no audit action shared
 * the user's 'generic' counter with every other such route: re-encrypting
 * face photos (an hour's window) could block the maintenance pages, whose
 * windows are a minute (review on #33).
 */

const state = { session: null as any }
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const { RateLimiter } = await import("@/lib/api-utils")

async function keyOf(route: (req: Request) => Promise<Response>, method = "POST") {
    state.session = { user: { id: "sa1", role: "SUPER_ADMIN" } }
    const spy = vi.spyOn(RateLimiter, "getLimitData").mockResolvedValue({ limited: true, resetAt: Date.now() } as any)
    const res = await route(new Request("https://nizmo.test/api/x", { method }))
    const key = spy.mock.calls[0]?.[0]
    spy.mockRestore()
    expect(res.status).toBe(429)
    return key
}

describe("the rate limit's counter", () => {
    it("re-encrypting face photos has a counter of its own", async () => {
        const { POST } = await import("@/app/api/system-settings/face/rekey/route")
        expect(await keyOf(POST)).toBe("sa1:REKEY_FACE_PHOTOS")
    })

    it("a route that names neither still uses the generic one, as before", async () => {
        const { GET } = await import("@/app/api/admin/maintenance/backups/route")
        expect(await keyOf(GET, "GET")).toBe("sa1:generic")
    })
})
