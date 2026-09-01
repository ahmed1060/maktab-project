import { describe, it, expect } from "vitest"
import { parsePaging } from "./pagination"

describe("parsePaging (F-08 pagination guard)", () => {
    it("defaults page=1 and the given default limit when unset", () => {
        const { page, limit, skip } = parsePaging(new URLSearchParams(), 20)
        expect(page).toBe(1)
        expect(limit).toBe(20)
        expect(skip).toBe(0)
    })

    it("computes skip from page and limit", () => {
        const { skip } = parsePaging(new URLSearchParams({ page: "3", limit: "10" }))
        expect(skip).toBe(20)
    })

    it("clamps an absurd limit instead of handing it to the database", () => {
        const { limit } = parsePaging(new URLSearchParams({ limit: "999999" }))
        expect(limit).toBeLessThanOrEqual(100)
    })

    it("falls back to defaults instead of NaN on garbage input", () => {
        const { page, limit } = parsePaging(new URLSearchParams({ page: "abc", limit: "abc" }), 20)
        expect(Number.isNaN(page)).toBe(false)
        expect(Number.isNaN(limit)).toBe(false)
        expect(page).toBe(1)
        expect(limit).toBe(20)
    })

    it("rejects a zero or negative page/limit rather than producing a negative skip", () => {
        const { page, limit } = parsePaging(new URLSearchParams({ page: "-5", limit: "0" }), 20)
        expect(page).toBeGreaterThanOrEqual(1)
        expect(limit).toBeGreaterThanOrEqual(1)
    })

    it("honors a custom max limit", () => {
        const { limit } = parsePaging(new URLSearchParams({ limit: "50" }), 20, 30)
        expect(limit).toBeLessThanOrEqual(30)
    })
})
