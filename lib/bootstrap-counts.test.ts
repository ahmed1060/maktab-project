import { describe, it, expect, vi } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * GET /api/me/bootstrap counts only unread notifications, for the bell.
 *
 * It also counted name changes waiting, for the top bar's button for them
 * alone. What waits to be reviewed, name changes among it, is counted on
 * Requests in the side bar now (lib/requests-waiting.test.ts), and the button
 * is gone, so nothing here asks for name changes, for anyone.
 */

const seen: any[] = []

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: async ({ where }: any) => ({
                admin: { id: "admin", role: "ADMIN", companyId: "c1", firstName: "A" },
                tl: { id: "tl", role: "TEAM_LEADER", companyId: "c1", firstName: "T" },
            } as any)[where.id] ?? null,
        },
        superAdmin: { findUnique: async ({ where }: any) => (where.id === "sa" ? { id: "sa", firstName: "S" } : null) },
        notification: { count: async () => 4 },
        company: { findMany: async () => [] },
        profileUpdateRequest: { count: async (args: any) => { seen.push(args.where); return 7 } },
    },
}))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { recipientFilter: () => ({}) } }))

describe("the bootstrap's counts", () => {
    it.each([
        ["an Admin", withGrants({ id: "admin", role: "ADMIN", companyId: "c1" })],
        ["a Team Leader", withGrants({ id: "tl", role: "TEAM_LEADER", companyId: "c1" })],
        ["the Super Admin", { id: "sa", role: "SUPER_ADMIN", companyId: null }],
    ])("are the unread notifications alone, for %s", async (_who, viewer) => {
        seen.length = 0
        const { SystemService } = await import("@/lib/services/system.service")
        const data = await SystemService.getBootstrapData(viewer as never)
        expect(data.counts).toEqual({ unreadNotifications: 4 })
        expect(seen).toEqual([])
    })
})
