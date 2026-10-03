import { describe, it, expect, vi } from "vitest"
import { generateSecret, generate } from "otplib"

/**
 * Found on production: a 26-character code typed into the 6-digit box threw
 * otplib's TokenLengthError out of sign-in, so the person saw "Something went
 * wrong" instead of "Invalid code". Anything that isn't six digits is simply
 * a wrong code.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
const { MfaService } = await import("@/lib/services/mfa.service")

describe("an authenticator code", () => {
    const secret = generateSecret()

    it("that isn't six digits is wrong, not an error", async () => {
        for (const code of ["", "12345", "1234567", "ABCDEF", "12345678901234567890123456", " 123456"]) {
            await expect(MfaService.verifyCode(secret, code), JSON.stringify(code)).resolves.toBe(false)
        }
    })

    it("that is right is still right", async () => {
        await expect(MfaService.verifyCode(secret, await generate({ secret }))).resolves.toBe(true)
    })
})
