import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The sign-in page asks for an email or a username (decided 2026-11-03):
 * every username is one account's, never with an @ in it (lib/username-rules.ts).
 */

const page = readFileSync("app/(auth)/login/page.tsx", "utf8")
const field = (() => {
    const start = page.indexOf("value={email}")
    return page.slice(page.lastIndexOf("<input", start), page.indexOf("/>", start))
})()
const label = page.slice(page.lastIndexOf("<label", page.indexOf("value={email}")), page.indexOf("value={email}"))

describe("the sign-in page's first field", () => {
    it("asks for an email or a username, in both languages", () => {
        expect(en.sign_in_identifier).toBe("Email or username")
        expect(ar.sign_in_identifier).toBe("البريد الإلكتروني أو اسم المستخدم")
        expect(label).toContain("{t('sign_in_identifier')}")
        expect(field).toContain("aria-label={t('sign_in_identifier')}")
        expect(field).toContain("placeholder={t('sign_in_identifier_placeholder')}")
        expect(en.sign_in_identifier_placeholder).not.toMatch(/^Enter/)
    })

    it("takes either: plain text, filled in as the account's name, never spell-checked or capitalised", () => {
        expect(field).toContain('type="text"')
        expect(field).not.toContain('type="email"')
        expect(field).toContain('autoComplete="username"')
        expect(field).toContain("spellCheck={false}")
        expect(field).toContain('autoCapitalize="none"')
    })

    it("says a wrong try is the email, username or password, not only the email", () => {
        expect(en.error_invalid_credentials).toBe("The email, username or password isn't right.")
        expect(ar.error_invalid_credentials).toBe("البريد الإلكتروني أو اسم المستخدم أو كلمة المرور غير صحيحة.")
    })

    it("carries an email, not a username, over to Forgot your password", () => {
        expect(page).toMatch(/setForgotEmail\(email\.includes\('@'\) \? email : ''\)/)
    })
})
