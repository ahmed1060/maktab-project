import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocked before the service is imported so the real lib/prisma module (which
// instantiates a real PrismaClient against DATABASE_URL) never loads.
const mockPrisma = {
    user: { findUnique: vi.fn() },
    salaryRecord: { upsert: vi.fn() },
    $transaction: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("./audit-log.service", () => ({ AuditLogService: { log: vi.fn() } }))
vi.mock("./notification.service", () => ({ NotificationService: { notify: vi.fn() } }))

const { SalaryService } = await import("./salary.service")

describe("SalaryService.addAdjustment", () => {
    const session = { user: { id: "admin-1", role: "ADMIN" } }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("rejects a zero amount before touching the database", async () => {
        await expect(SalaryService.addAdjustment("user-1", "BONUS", 0, session)).rejects.toThrow(
            "INVALID_ADJUSTMENT_AMOUNT"
        )
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    })

    it("rejects a negative amount", async () => {
        await expect(SalaryService.addAdjustment("user-1", "DEDUCTION", -5, session)).rejects.toThrow(
            "INVALID_ADJUSTMENT_AMOUNT"
        )
    })

    it("rejects an amount above the 1000-day cap", async () => {
        await expect(SalaryService.addAdjustment("user-1", "DEDUCTION", 1001, session)).rejects.toThrow(
            "INVALID_ADJUSTMENT_AMOUNT"
        )
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    })

    it("accepts the boundary value of exactly 1000 and completes the transaction", async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ salary: 5000 })
        mockPrisma.$transaction.mockImplementation(async (fn: any) =>
            fn({
                salaryRecord: {
                    upsert: vi.fn().mockResolvedValue({ id: "rec-1" }),
                    update: vi.fn(),
                },
                salaryAdjustment: { create: vi.fn().mockResolvedValue({ id: "adj-1", type: "BONUS", amount: 1000 }) },
            })
        )

        const result = await SalaryService.addAdjustment("user-1", "BONUS", 1000, session)
        expect(result).toMatchObject({ id: "adj-1" })
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { salary: true } })
    })
})
