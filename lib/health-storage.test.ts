import { describe, it, expect, vi } from "vitest"

/**
 * The Super Admin's health page when file storage can't be reached.
 *
 * Listing the files threw, and took the whole health check with it: a 500,
 * and a page with nothing on it, at the moment it was most needed. Found by
 * calling every API route; locally there is no file storage at all.
 */
const storage = { fails: true }

vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { count: async () => 7 }, notification: { count: async () => 3 } } }))
vi.mock("@/lib/storage", () => ({
    supabase: { storage: { from: () => ({ list: async () => storage.fails ? { data: null, error: new Error("fetch failed") } : { data: [{ id: "1", name: "a.png" }], error: null } }) } },
}))

const { MaintenanceService } = await import("@/lib/services/maintenance.service")

describe("the health check", () => {
    it("still reports, and says storage is unreachable, when it is", async () => {
        storage.fails = true
        const stats = await MaintenanceService.getStats()
        expect(stats.storage).toEqual({ totalFiles: null, reachable: false })
        expect(stats.auditing.total).toBe(7)
    })

    it("counts the files when storage answers", async () => {
        storage.fails = false
        expect((await MaintenanceService.getStats()).storage).toEqual({ totalFiles: 1, reachable: true })
    })

    it("and the page says so rather than showing an empty figure", async () => {
        const { readFileSync } = await import("node:fs")
        const page = readFileSync("app/(dashboard)/dashboard/health/page.tsx", "utf8")
        expect(page).toContain("metrics?.storage.reachable === false ? '—' : metrics?.storage.totalFiles")
        expect(page).toContain("t('storage_unreachable' as any)")
    })
})
