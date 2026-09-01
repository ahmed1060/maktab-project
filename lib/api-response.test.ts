import { describe, it, expect } from "vitest"
import { Prisma } from "@prisma/client"
import { ApiResponse } from "./api-response"

describe("ApiResponse.success — Decimal normalization (F-07)", () => {
    it("converts a top-level Decimal field to a plain number", async () => {
        const res = ApiResponse.success({ salary: new Prisma.Decimal("5000.50") })
        const body = await res.json()
        expect(body.data.salary).toBe(5000.5)
        expect(typeof body.data.salary).toBe("number")
    })

    it("converts Decimal fields nested inside an object", async () => {
        const res = ApiResponse.success({
            task: { id: "t1", totalCost: new Prisma.Decimal("1234.56") },
        })
        const body = await res.json()
        expect(body.data.task.totalCost).toBe(1234.56)
    })

    it("converts Decimal fields inside an array of records", async () => {
        const res = ApiResponse.success([
            { id: "a", amount: new Prisma.Decimal("10.00") },
            { id: "b", amount: new Prisma.Decimal("20.25") },
        ])
        const body = await res.json()
        expect(body.data.map((r: any) => r.amount)).toEqual([10, 20.25])
    })

    it("leaves Date fields intact rather than flattening them to {}", async () => {
        const now = new Date("2026-01-15T00:00:00.000Z")
        const res = ApiResponse.success({ createdAt: now, cost: new Prisma.Decimal("1") })
        const body = await res.json()
        // Dates serialize to ISO strings through JSON either way — the point
        // is it must still be that ISO string, not an empty object.
        expect(body.data.createdAt).toBe(now.toISOString())
    })

    it("leaves plain numbers and other primitives untouched", async () => {
        const res = ApiResponse.success({ count: 3, active: true, name: "x", note: null })
        const body = await res.json()
        expect(body.data).toEqual({ count: 3, active: true, name: "x", note: null })
    })
})
