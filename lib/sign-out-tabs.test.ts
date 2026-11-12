import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Signing out takes the browser's tabs off who's online (REALTIME_PLAN.md §3,
 * part 6a, PR 262). Each tab's row says which session it came from, and the
 * session ends with signing out, before the tabs hear of it: their own
 * reports after that are refused. So the server closes them as the session
 * ends, every tab of that browser's session and none of the person's other
 * devices (UserService.closeSessionTabs, checked in lib/presence.db.test.ts).
 */

const closed: [string, string][] = []
vi.mock("@/lib/services/user.service", () => ({
    UserService: { closeSessionTabs: async (userId: string, sid: string) => { closed.push([userId, sid]); return 1 } },
}))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async () => {}, logSystemError: async () => "ref" },
}))

const { authOptions } = await import("@/lib/auth")
const signOut = (token: Record<string, unknown> | null) => authOptions.events!.signOut!({ token, session: null } as any)

beforeEach(() => { closed.length = 0 })

describe("signing out", () => {
    it("closes the tabs of the session it ends", async () => {
        await signOut({ sub: "e1", sid: "laptop", role: "EMPLOYEE" })
        expect(closed).toEqual([["e1", "laptop"]])
    })

    it("asks nothing of a Super Admin, who has no tabs, or a session without a name", async () => {
        await signOut({ sub: "sa-1", sid: "s", role: "SUPER_ADMIN" })
        await signOut({ sub: "e1", role: "EMPLOYEE" })
        await signOut({ sid: "s" })
        await signOut(null)
        expect(closed).toEqual([])
    })

    it("never stops the signing out, whatever goes wrong", async () => {
        const { UserService } = await import("@/lib/services/user.service")
        const spy = vi.spyOn(UserService, "closeSessionTabs").mockRejectedValueOnce(new Error("down"))
        await expect(signOut({ sub: "e1", sid: "laptop", role: "EMPLOYEE" })).resolves.toBeUndefined()
        spy.mockRestore()
    })
})
