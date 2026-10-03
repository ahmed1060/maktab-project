import { describe, it, expect } from "vitest"
import { bearerToken, hashSecret, newAgentToken, newEnrolmentCode, normaliseEnrolmentCode } from "./agent-credentials"

describe("agent credentials (ATTENDANCE_PLAN.md §17)", () => {
    it("makes enrolment codes that are easy to read off a screen and type", () => {
        for (let i = 0; i < 200; i++) {
            const code = newEnrolmentCode()
            expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
            expect(code).not.toMatch(/[01OIL]/)
        }
    })

    it("reads a code however it was typed, and refuses what cannot be one", () => {
        expect(normaliseEnrolmentCode(" k7qd 2mxp ")).toBe("K7QD-2MXP")
        expect(normaliseEnrolmentCode("K7QD-2MXP")).toBe("K7QD-2MXP")
        expect(normaliseEnrolmentCode("K7QD-2MX")).toBeNull()
        expect(normaliseEnrolmentCode("K7QD-2MX0")).toBeNull()
        expect(normaliseEnrolmentCode("")).toBeNull()
    })

    it("issues long, distinct tokens, and stores only their hash", () => {
        const a = newAgentToken(), b = newAgentToken()
        expect(a).not.toBe(b)
        expect(a).toMatch(/^mka_[A-Za-z0-9_-]{43}$/)
        expect(hashSecret(a)).toMatch(/^[0-9a-f]{64}$/)
        expect(hashSecret(a)).not.toBe(hashSecret(b))
    })

    it("takes the token from a Bearer header, and nothing else", () => {
        const t = newAgentToken()
        expect(bearerToken(`Bearer ${t}`)).toBe(t)
        expect(bearerToken(`bearer ${t}`)).toBe(t)
        expect(bearerToken(t)).toBeNull()
        expect(bearerToken("Bearer abc")).toBeNull()
        expect(bearerToken(null)).toBeNull()
    })
})
