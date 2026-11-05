import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Each sign-in field says what it is for (WCAG 1.3.5, Identify Input
 * Purpose), so password managers and browser autofill, which many disabled
 * users depend on, fill the right one instead of guessing. None did
 * (accessibility audit, 4 October 2026).
 */
// The page's own, none since Forgot your password has its steps too, then
// each step's, on the building blocks (DESIGN.md §5.5, Sign-in). Checkboxes
// name no purpose.
const files = [
    "app/(auth)/login/page.tsx",
    "components/sign-in/CredentialsStep.tsx",
    "components/sign-in/CodeStep.tsx",
    "components/sign-in/ResetPassword.tsx",
]
const inputs = files
    .flatMap(f => [...readFileSync(f, "utf8").matchAll(/<(?:input|TextInput|PasswordInput)\b([\s\S]*?)\/>/g)].map(m => m[1]))
    .filter(attrs => !attrs.includes('type="checkbox"'))
const purpose = (attrs: string) => attrs.match(/autoComplete="([^"]+)"/)?.[1] ?? null

describe("the sign-in fields", () => {
    it("are all found", () => {
        expect(inputs).toHaveLength(7)
    })

    it("name the account, the password, a new password and one-time codes", () => {
        const got = inputs.map(a => {
            const kind = /value=\{(\w+)\}/.exec(a)?.[1]
            return `${kind}: ${purpose(a)}`
        })
        expect(got).toEqual([
            "identifier: username",
            "password: current-password",
            "code: one-time-code",
            // Forgot your password: the account's email, the code sent to it,
            // and the new password, asked twice.
            "email: username",
            "code: one-time-code",
            "newPassword: new-password",
            "confirmPassword: new-password",
        ])
    })
})
