import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocked before the service loads, so the real lib/prisma never instantiates a
// client against DATABASE_URL.
const mockPrisma = {
    auditLog: { findMany: vi.fn(), count: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const { AuditLogService } = await import("./audit-log.service")

/**
 * The audit log's date range (UI_PLAN.md §5 step 5, Operations part 2). The
 * date range picker sends calendar days, which were read as midnight UTC:
 * "to 3 November" stopped at the first moment of the 3rd, so that day's
 * entries were left out, and in Cairo "from 3 November" took in the last
 * two hours of the 2nd. They're days where the platform is, as every other
 * list's are (lib/day-range.ts). A moment, as the dashboard's System errors
 * link sends, is still a moment.
 */
describe("AuditLogService.getMany's date range", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockPrisma.auditLog.findMany.mockResolvedValue([])
        mockPrisma.auditLog.count.mockResolvedValue(0)
    })
    const where = () => mockPrisma.auditLog.findMany.mock.calls[0][0].where

    it("takes in the whole of each day, in Cairo", async () => {
        await AuditLogService.getMany(0, 20, { startDate: "2026-11-03", endDate: "2026-11-03" })
        // Cairo is UTC+2 in November.
        expect(where().createdAt).toEqual({ gte: new Date("2026-11-02T22:00:00.000Z"), lte: new Date("2026-11-03T21:59:59.999Z") })
    })

    it("still takes a moment as that moment", async () => {
        await AuditLogService.getMany(0, 20, { startDate: "2026-11-02T06:00:00.000Z" })
        expect(where().createdAt).toEqual({ gte: new Date("2026-11-02T06:00:00.000Z") })
    })
})
