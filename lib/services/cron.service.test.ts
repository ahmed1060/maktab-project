import { describe, it, expect, vi, beforeEach } from "vitest"
import { RECONSTRUCTED_NOTE } from "@/lib/leave-reset"

// Mocked before the service loads, so the real lib/prisma never instantiates a
// client against DATABASE_URL.
const mockPrisma = {
    user: { findMany: vi.fn(), update: vi.fn() },
    dayOffCreditSnapshot: { createMany: vi.fn() },
    $transaction: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("./audit-log.service", () => ({ AuditLogService: { log: vi.fn() } }))

const { CronService } = await import("./cron.service")

/**
 * The first test cron.service.ts has ever had.
 *
 * It deserves one more than most files here: the leave reset fires at one
 * o'clock on the 1st of January and nowhere else, so nobody will notice a fault
 * in it for up to a year, and by then the damage is a table that cannot be
 * corrected.
 */
const tx = () => {
    const createMany = vi.fn().mockImplementation(({ data }: any) => ({ count: data.length }))
    const update = vi.fn()
    return {
        client: {
            dayOffCreditSnapshot: { createMany },
            user: { update },
        },
        createMany,
        update,
    }
}

describe("CronService.resetDayOffCredits", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        // Midday in Cairo on the 2nd, so the calendar year is unambiguous.
        vi.setSystemTime(new Date("2026-01-02T10:00:00Z"))
    })

    const run = async (users: any[]) => {
        mockPrisma.user.findMany.mockResolvedValue(users)
        const harness = tx()
        mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(harness.client))
        const result = await CronService.resetDayOffCredits()
        return { result, ...harness }
    }

    it("snapshots the closing balance and hands the allowance back", async () => {
        const { result, createMany, update } = await run([
            { id: "u1", lastDayOffResetYear: 2025, baseDayOffCredit: 21, dayOffCredit: 4 },
        ])

        expect(createMany).toHaveBeenCalledWith({
            data: [{ userId: "u1", year: 2025, baseCredit: 21, remainingCredit: 4, note: null }],
            skipDuplicates: true,
        })
        expect(update).toHaveBeenCalledWith({
            where: { id: "u1" },
            data: { dayOffCredit: 21, lastDayOffResetYear: 2026 },
        })
        expect(result).toMatchObject({ success: true, count: 1, snapshots: 1, year: 2026 })
    })

    it("writes a row for every year a missed run skipped", async () => {
        // Two Januaries missed. The old code wrote one row for 2023 and jumped
        // straight to 2026, and [userId, year] being unique meant 2024 and 2025
        // could never be recorded afterwards.
        const { createMany } = await run([
            { id: "u1", lastDayOffResetYear: 2023, baseDayOffCredit: 21, dayOffCredit: 7 },
        ])

        const rows = createMany.mock.calls[0][0].data
        expect(rows.map((r: any) => r.year)).toEqual([2023, 2024, 2025])
        expect(rows.filter((r: any) => r.note === RECONSTRUCTED_NOTE).map((r: any) => r.year))
            .toEqual([2024, 2025])
    })

    it("skips a row that already exists instead of failing the whole account", async () => {
        // A unique-constraint collision used to abort the transaction, so that
        // account was never reset — and would fail identically every year after.
        const { createMany } = await run([
            { id: "u1", lastDayOffResetYear: 2025, baseDayOffCredit: 21, dayOffCredit: 4 },
        ])
        expect(createMany.mock.calls[0][0].skipDuplicates).toBe(true)
    })

    it("refuses an account whose last reset year is corrupt, and names it", async () => {
        const { result, createMany, update } = await run([
            { id: "u1", lastDayOffResetYear: 0, baseDayOffCredit: 21, dayOffCredit: 4 },
        ])

        expect(createMany).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
        expect(result.refused).toEqual([{ userId: "u1", lastResetYear: 0 }])
        expect(result.count).toBe(0)
    })

    it("carries on with the rest when one account fails", async () => {
        mockPrisma.user.findMany.mockResolvedValue([
            { id: "bad", lastDayOffResetYear: 2025, baseDayOffCredit: 21, dayOffCredit: 4 },
            { id: "good", lastDayOffResetYear: 2025, baseDayOffCredit: 21, dayOffCredit: 9 },
        ])
        let call = 0
        mockPrisma.$transaction.mockImplementation(async (fn: any) => {
            call++
            if (call === 1) throw new Error("deadlock")
            return fn(tx().client)
        })
        vi.spyOn(console, "error").mockImplementation(() => { })

        const result = await CronService.resetDayOffCredits()
        expect(result.count).toBe(1)
    })

    it("uses the company's calendar year, not the server's", async () => {
        // 21:30 UTC on 31 December is already 23:30 or half past midnight in
        // Cairo. The year this job resets into has to be the one the company is
        // living in, which is the whole of P0's rule in one assertion.
        vi.setSystemTime(new Date("2025-12-31T22:30:00Z"))
        const { result } = await run([
            { id: "u1", lastDayOffResetYear: 2025, baseDayOffCredit: 21, dayOffCredit: 4 },
        ])
        expect(result.year).toBe(2026)
    })
})
