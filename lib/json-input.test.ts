import { describe, it, expect } from "vitest"
import { normalizeJsonInput } from "./json-input"

describe("normalizeJsonInput (F-12)", () => {
    it("parses a JSON-encoded string into its real value", () => {
        expect(normalizeJsonInput('[{"url":"a.png"}]')).toEqual([{ url: "a.png" }])
        expect(normalizeJsonInput('{"a":1}')).toEqual({ a: 1 })
    })

    it("passes an already-parsed array or object through unchanged", () => {
        const arr = [{ url: "a.png" }]
        const obj = { a: 1 }
        expect(normalizeJsonInput(arr)).toBe(arr)
        expect(normalizeJsonInput(obj)).toBe(obj)
    })

    it("returns a non-JSON string as-is rather than throwing", () => {
        expect(normalizeJsonInput("just a plain string")).toBe("just a plain string")
    })

    it("passes through null/undefined/numbers/booleans unchanged", () => {
        expect(normalizeJsonInput(null)).toBeNull()
        expect(normalizeJsonInput(undefined)).toBeUndefined()
        expect(normalizeJsonInput(5)).toBe(5)
        expect(normalizeJsonInput(true)).toBe(true)
    })
})
