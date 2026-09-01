import { describe, it, expect } from "vitest"
import { generateTempPassword } from "./generate-password"

describe("generateTempPassword", () => {
    it("generates a password of the requested length", () => {
        expect(generateTempPassword(16)).toHaveLength(16)
        expect(generateTempPassword(24)).toHaveLength(24)
    })

    it("avoids visually-ambiguous characters (0/O, 1/l/I)", () => {
        const password = generateTempPassword(500)
        expect(password).not.toMatch(/[0O1lI]/)
    })

    it("is not deterministic across calls", () => {
        const a = generateTempPassword()
        const b = generateTempPassword()
        expect(a).not.toBe(b)
    })
})
