import { describe, it, expect, vi } from "vitest"

/**
 * The Companies list finds a company by part of its name, any case (the
 * Super Admin's pages part 3a). The counts its tabs show stay the whole
 * list's, so a search doesn't make "Needs attention 0" untrue.
 */
const now = new Date("2026-11-02T12:00:00Z")
const row = (id: string, name: string, createdAt: Date, trialPreset = "THREE_MONTHS") => ({
    id, name, isBanned: false, createdAt, trialPreset, trialExtensionDays: 0,
    package: null, payments: [], _count: { payments: 0 },
})
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: {
            findMany: async () => [
                // Its trial ends in 4 days: needs attention. The others have months.
                row("c1", "Delta Sites", new Date("2026-10-23T12:00:00Z"), "FOURTEEN_DAYS"),
                row("c2", "Nile Works", new Date("2026-11-01T12:00:00Z")),
                row("c3", "delta Foods", new Date("2026-11-01T12:00:00Z")),
            ],
        },
    },
}))

describe("the companies list's search", () => {
    it("keeps the companies whose name holds what's asked, any case", async () => {
        const { CompanyService } = await import("@/lib/services/company.service")
        const found = await CompanyService.listWithSubscription({ search: "DELTA", now })
        expect(found.data.map(c => c.name)).toEqual(["Delta Sites", "delta Foods"])
        expect(found.total).toBe(2)
    })

    it("narrows the tab it's in, and leaves the tabs' counts alone", async () => {
        const { CompanyService } = await import("@/lib/services/company.service")
        const found = await CompanyService.listWithSubscription({ search: "nile", filter: "needs-attention", now })
        expect(found.data).toEqual([])
        expect({ all: found.totalCompanies, attention: found.needsAttentionCount }).toEqual({ all: 3, attention: 1 })
    })

    it("asks nothing of a blank search", async () => {
        const { CompanyService } = await import("@/lib/services/company.service")
        expect((await CompanyService.listWithSubscription({ search: "  ", now })).total).toBe(3)
    })
})
