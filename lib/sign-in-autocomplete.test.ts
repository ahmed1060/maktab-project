import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Each sign-in field says what it is for (WCAG 1.3.5, Identify Input
 * Purpose), so password managers and browser autofill, which many disabled
 * users depend on, fill the right one instead of guessing. None did
 * (accessibility audit, 4 October 2026).
 */
const page = readFileSync("app/(auth)/login/page.tsx", "utf8")
const inputs = [...page.matchAll(/<input\b([\s\S]*?)\/>/g)].map(m => m[1])
const purpose = (attrs: string) => attrs.match(/autoComplete="([^"]+)"/)?.[1] ?? null

describe("the sign-in fields", () => {
    it("are all found", () => {
        expect(inputs).toHaveLength(6)
    })

    it("name the account, the password, a new password and one-time codes", () => {
        const got = inputs.map(a => {
            const kind = /value=\{(\w+)\}/.exec(a)?.[1]
            return `${kind}: ${purpose(a)}`
        })
        expect(got).toEqual([
            "forgotEmail: username",
            "forgotCode: one-time-code",
            "forgotNewPassword: new-password",
            "email: username",
            "password: current-password",
            "mfaCode: one-time-code",
        ])
    })
})
