import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocked before the service is imported so the real lib/prisma module (which
// instantiates a real PrismaClient against DATABASE_URL) never loads.
const mockPrisma = {
    user: { findUnique: vi.fn() },
    salaryRecord: { upsert: vi.fn(), findMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    salaryAdjustment: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("./audit-log.service", () => ({ AuditLogService: { log: vi.fn() } }))
vi.mock("./notification.service", () => ({ NotificationService: { notify: vi.fn() } }))
// No salary history in these fixtures, so the base salary falls back to
// User.salary — which is the path this mock is asserting on.
vi.mock("./salary-history.service", () => ({
    SalaryHistoryService: { ratesForMonth: vi.fn().mockRejectedValue(new Error("no history")) },
}))

const { SalaryService, isTerminalAdjustment, TERMINAL_ADJUSTMENT_STATUSES } = await import("./salary.service")

const session = { user: { id: "admin-1", role: "ADMIN" } }

/** A transaction client with just the pieces these paths touch. */
const txClient = () => ({
    salaryRecord: {
        upsert: vi.fn().mockResolvedValue({ id: "rec-1" }),
        update: vi.fn(),
    },
    salaryAdjustment: {
        create: vi.fn().mockImplementation(({ data }: any) => ({ id: "adj-1", ...data })),
        update: vi.fn().mockImplementation(({ data }: any) => ({ id: "adj-1", amount: 3, ...data })),
    },
})

beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ salary: 5000 })
})

describe("the amount bound is checked at the one door", () => {
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

    it("applies to the automated sources too, not just the manual one", async () => {
        // The cap used to live on addAdjustment alone, so a task penalty or a
        // day-off deduction could write any number at all into a salary record.
        await expect(SalaryService.applyAdjustment({
            userId: "user-1", type: "DEDUCTION", amount: 5000, source: "TASK_PENALTY",
        })).rejects.toThrow("INVALID_ADJUSTMENT_AMOUNT")

        await expect(SalaryService.applyAdjustment({
            userId: "user-1", type: "DEDUCTION", amount: Number.NaN, source: "DAY_OFF",
        })).rejects.toThrow("INVALID_ADJUSTMENT_AMOUNT")
    })

    it("accepts the boundary value of exactly 1000", async () => {
        const client = txClient()
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(client))

        const result = await SalaryService.addAdjustment("user-1", "BONUS", 1000, session)
        expect(result).toMatchObject({ id: "adj-1", amount: 1000 })
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { salary: true } })
    })
})

describe("an adjustment records the month it belongs to", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-09-17T09:00:00Z"))
    })

    it("defaults to the current month, and stores it", async () => {
        const client = txClient()
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(client))

        await SalaryService.applyAdjustment({
            userId: "user-1", type: "DEDUCTION", amount: 2, source: "MANUAL",
        })

        expect(client.salaryAdjustment.create.mock.calls[0][0].data)
            .toMatchObject({ month: 9, year: 2026, source: "MANUAL" })
    })

    it("takes an explicit period, so a past month can be adjusted at all", async () => {
        // The capability the period columns exist for: a deduction agreed on 2
        // October for September's payroll. With the month inferred from the
        // write time it could not be expressed.
        const client = txClient()
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(client))

        await SalaryService.applyAdjustment({
            userId: "user-1", type: "DEDUCTION", amount: 2, source: "MANUAL",
            month: 8, year: 2026,
        })

        expect(client.salaryRecord.upsert.mock.calls[0][0].where.userId_month_year)
            .toEqual({ userId: "user-1", month: 8, year: 2026 })
        expect(client.salaryAdjustment.create.mock.calls[0][0].data)
            .toMatchObject({ month: 8, year: 2026 })
    })

    it("carries its source and the thing it came from", async () => {
        const client = txClient()
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(client))

        await SalaryService.applyAdjustment({
            userId: "user-1", type: "DEDUCTION", amount: 1, source: "DAY_OFF", sourceId: "req-9",
        })

        expect(client.salaryAdjustment.create.mock.calls[0][0].data)
            .toMatchObject({ source: "DAY_OFF", sourceId: "req-9" })
    })

    it("increments the record it wrote the adjustment against", async () => {
        const client = txClient()
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(client))

        await SalaryService.applyAdjustment({
            userId: "user-1", type: "BONUS", amount: 3, source: "MANUAL",
        })

        expect(client.salaryRecord.update).toHaveBeenCalledWith({
            where: { id: "rec-1" },
            data: { bonusDays: { increment: 3 }, deductions: undefined },
        })
    })
})

describe("undoing an adjustment reads where the days went", () => {
    const active = {
        id: "adj-1", userId: "user-1", type: "DEDUCTION", amount: 3,
        status: "ACTIVE", month: 8, year: 2026, source: "MANUAL", reason: null,
    }

    it("decrements the month stored on the row, not the month it was written in", async () => {
        // The old code re-derived the month from createdAt. That is the same
        // answer right up until it is not — and when it is not, the record that
        // was incremented keeps the deduction forever while a different one is
        // credited.
        mockPrisma.salaryAdjustment.findUnique.mockResolvedValue(active)
        mockPrisma.salaryRecord.findUnique.mockResolvedValue({ id: "rec-8" })
        const client = txClient()
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(client))

        await SalaryService.rollbackAdjustment("user-1", "adj-1", session)

        expect(mockPrisma.salaryRecord.findUnique).toHaveBeenCalledWith({
            where: { userId_month_year: { userId: "user-1", month: 8, year: 2026 } },
        })
        expect(client.salaryRecord.update).toHaveBeenCalledWith({
            where: { id: "rec-8" },
            data: { bonusDays: undefined, deductions: { decrement: 3 } },
        })
    })

    it("refuses an adjustment that was already rolled back", async () => {
        mockPrisma.salaryAdjustment.findUnique.mockResolvedValue({ ...active, status: "ROLLED_BACK" })
        await expect(SalaryService.rollbackAdjustment("user-1", "adj-1", session))
            .rejects.toThrow("INVALID_ADJUSTMENT")
    })

    it("refuses an adjustment that was already reversed", async () => {
        // The guard that did not exist: only ROLLED_BACK was checked, so once
        // a second terminal status arrived an adjustment could be undone twice
        // and the second undo would credit days that were only taken once.
        mockPrisma.salaryAdjustment.findUnique.mockResolvedValue({ ...active, status: "REVERSED" })
        await expect(SalaryService.rollbackAdjustment("user-1", "adj-1", session))
            .rejects.toThrow("INVALID_ADJUSTMENT")
        await expect(SalaryService.reverseAdjustment("user-1", "adj-1", session))
            .rejects.toThrow("INVALID_ADJUSTMENT")
    })

    it("refuses an adjustment belonging to somebody else", async () => {
        mockPrisma.salaryAdjustment.findUnique.mockResolvedValue({ ...active, userId: "other" })
        await expect(SalaryService.rollbackAdjustment("user-1", "adj-1", session))
            .rejects.toThrow("INVALID_ADJUSTMENT")
    })

    it("writes the outcome the caller asked for", async () => {
        mockPrisma.salaryAdjustment.findUnique.mockResolvedValue(active)
        mockPrisma.salaryRecord.findUnique.mockResolvedValue({ id: "rec-8" })
        const client = txClient()
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(client))

        await SalaryService.reverseAdjustment("user-1", "adj-1", session, "Appealed")
        expect(client.salaryAdjustment.update.mock.calls[0][0].data).toEqual({ status: "REVERSED" })
    })

    it("audits the two under different actions", async () => {
        const { AuditLogService } = await import("./audit-log.service")
        mockPrisma.salaryRecord.findUnique.mockResolvedValue({ id: "rec-8" })
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(txClient()))

        mockPrisma.salaryAdjustment.findUnique.mockResolvedValue(active)
        await SalaryService.rollbackAdjustment("user-1", "adj-1", session)
        mockPrisma.salaryAdjustment.findUnique.mockResolvedValue(active)
        await SalaryService.reverseAdjustment("user-1", "adj-1", session)

        const actions = (AuditLogService.log as any).mock.calls.map((c: any[]) => c[0])
        expect(actions).toEqual(["ROLLBACK_SALARY_ADJUSTMENT", "REVERSE_SALARY_ADJUSTMENT"])
    })
})

describe("both terminal statuses", () => {
    it("are the two that end an adjustment", () => {
        expect([...TERMINAL_ADJUSTMENT_STATUSES]).toEqual(["ROLLED_BACK", "REVERSED"])
        expect(isTerminalAdjustment("ACTIVE")).toBe(false)
        expect(isTerminalAdjustment("ROLLED_BACK")).toBe(true)
        expect(isTerminalAdjustment("REVERSED")).toBe(true)
    })
})

describe("getHistory is a read", () => {
    it("returns records without creating any", async () => {
        mockPrisma.salaryRecord.findMany.mockResolvedValue([])
        await SalaryService.getHistory("user-1")
        expect(mockPrisma.salaryRecord.upsert).not.toHaveBeenCalled()
        expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })
})
