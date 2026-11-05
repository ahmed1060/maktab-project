import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The sign-in page asks for an email or a username (decided 2026-11-03):
 * every username is one account's, never with an @ in it (lib/username-rules.ts).
 * Its field is the building blocks' since the sign-in page's part 1
 * (DESIGN.md §5.5, Sign-in), in the first step's own file.
 */

const step = readFileSync("components/sign-in/CredentialsStep.tsx", "utf8")
const page = readFileSync("app/(auth)/login/page.tsx", "utf8")
const field = (() => {
    const start = step.indexOf("value={identifier}")
    return step.slice(step.lastIndexOf("<TextInput", start), step.indexOf("/>", start))
})()
const label = step.slice(step.lastIndexOf("<Field", step.indexOf("value={identifier}")), step.indexOf("value={identifier}"))

describe("the sign-in page's first field", () => {
    it("asks for an email or a username, in both languages", () => {
        expect(en.sign_in_identifier).toBe("Email or username")
        expect(ar.sign_in_identifier).toBe("البريد الإلكتروني أو اسم المستخدم")
        expect(label).toContain("label={t('sign_in_identifier')}")
        // Its label says what it is: the placeholder said it again, and in
        // Arabic, written left to right, it was cut short at its start.
        expect(field).not.toContain("placeholder")
    })

    it("takes either: plain text, filled in as the account's name, never spell-checked or capitalised", () => {
        expect(field).toContain('type="text"')
        expect(field).not.toContain('type="email"')
        expect(field).toContain('autoComplete="username"')
        expect(field).toContain("spellCheck={false}")
        expect(field).toContain('autoCapitalize="none"')
    })

    it("is written left to right in Arabic too, as emails and usernames are (DESIGN.md §3.3)", () => {
        expect(field).toContain('dir="ltr"')
        expect(field).not.toMatch(/direction: locale === 'ar' \? 'rtl'/)
    })

    it("says a wrong try is the email, username or password, not only the email", () => {
        expect(en.error_invalid_credentials).toBe("The email, username or password isn't right.")
        expect(ar.error_invalid_credentials).toBe("البريد الإلكتروني أو اسم المستخدم أو كلمة المرور غير صحيحة.")
    })

    it("carries an email, not a username, over to Forgot your password", () => {
        expect(page).toMatch(/setForgotEmail\(identifier\.includes\('@'\) \? identifier\.trim\(\) : ''\)/)
    })
})
