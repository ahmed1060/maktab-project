import { describe, it, expect, vi, beforeEach } from "vitest"

// Mocked before api-utils (and therefore RateLimiter) is imported, so calls
// never attempt real network I/O against an unconfigured database.
const mockPrisma = {
    rateLimit: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
    },
}

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const { RateLimiter } = await import("./api-utils")

describe("RateLimiter (F-10)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("starts a new window via upsert when no record exists yet", async () => {
        mockPrisma.rateLimit.findUnique.mockResolvedValue(null)
        mockPrisma.rateLimit.upsert.mockResolvedValue({ key: "k", count: 1, resetAt: new Date(Date.now() + 1000) })

        const result = await RateLimiter.getLimitData("k", 5, 1000)

        expect(result.limited).toBe(false)
        expect(mockPrisma.rateLimit.update).not.toHaveBeenCalled()
    })

    it("increments atomically within an active window and allows requests under the limit", async () => {
        const resetAt = new Date(Date.now() + 60_000)
        mockPrisma.rateLimit.findUnique.mockResolvedValue({ key: "k", count: 2, resetAt })
        mockPrisma.rateLimit.update.mockResolvedValue({ key: "k", count: 3, resetAt })

        const result = await RateLimiter.getLimitData("k", 5, 60_000)

        expect(mockPrisma.rateLimit.update).toHaveBeenCalledWith({
            where: { key: "k" },
            data: { count: { increment: 1 } },
        })
        expect(result.limited).toBe(false)
    })

    it("limits once the atomic increment pushes the count past the limit", async () => {
        const resetAt = new Date(Date.now() + 60_000)
        mockPrisma.rateLimit.findUnique.mockResolvedValue({ key: "k", count: 4, resetAt })
        // The 5th call increments 4 -> 5, the limit; still not limited (>, not >=).
        mockPrisma.rateLimit.update.mockResolvedValue({ key: "k", count: 6, resetAt })

        const result = await RateLimiter.getLimitData("k", 5, 60_000)

        expect(result.limited).toBe(true)
    })

    it("fails CLOSED on a database error, not open (regression for F-10)", async () => {
        mockPrisma.rateLimit.findUnique.mockRejectedValue(new Error("connection refused"))

        const result = await RateLimiter.getLimitData("k", 5, 60_000)

        // The pre-fix behavior here was `limited: false` — silently allowing
        // the request and resetting the counter to 1 on any DB hiccup.
        expect(result.limited).toBe(true)
    })

    it("never uses a local in-memory count across calls — every call re-reads the database", async () => {
        const resetAt = new Date(Date.now() + 60_000)
        mockPrisma.rateLimit.findUnique.mockResolvedValue({ key: "k", count: 1, resetAt })
        mockPrisma.rateLimit.update.mockResolvedValue({ key: "k", count: 2, resetAt })

        await RateLimiter.getLimitData("k", 5, 60_000)
        await RateLimiter.getLimitData("k", 5, 60_000)

        // Two calls, two real database reads — no short-circuit on a cached value.
        expect(mockPrisma.rateLimit.findUnique).toHaveBeenCalledTimes(2)
    })
})
