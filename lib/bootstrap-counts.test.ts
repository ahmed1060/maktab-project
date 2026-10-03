import { describe, it, expect, vi } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The header's name-change badge counts the viewer's own company.
 *
 * GET /api/me/bootstrap counted every company's pending name-change requests
 * for an Admin, so the badge on one company's screen carried the others'
 * numbers. Each count's query is captured here rather than trusted.
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
        notification: { count: async () => 0 },
        company: { findMany: async () => [] },
        profileUpdateRequest: { count: async (args: any) => { seen.push(args.where); return 7 } },
    },
}))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { recipientFilter: () => ({}) } }))

describe("the name-change badge", () => {
    it("counts only the Admin's own company", async () => {
        seen.length = 0
        const { SystemService } = await import("@/lib/services/system.service")
        const data = await SystemService.getBootstrapData(withGrants({ id: "admin", role: "ADMIN", companyId: "c1" }))
        expect(seen).toEqual([{ status: "PENDING", user: { companyId: "c1" } }])
        expect(data.counts.pendingProfileRequests).toBe(7)
    })

    it("is not counted for someone who does not decide them", async () => {
        seen.length = 0
        const { SystemService } = await import("@/lib/services/system.service")
        const data = await SystemService.getBootstrapData(withGrants({ id: "tl", role: "TEAM_LEADER", companyId: "c1" }))
        expect(seen).toEqual([])
        expect(data.counts.pendingProfileRequests).toBe(0)
    })
})
