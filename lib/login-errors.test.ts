import { describe, it, expect } from "vitest"
import { signInErrorKey, codeErrorKey } from "./login-errors"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Found on production: the sign-in page showed "Invalid email or password"
 * while the server was saying "Too many login attempts", so a Super Admin
 * with the right password thought the account was locked.
 */
describe("the sign-in page's message", () => {
    const tooMany = "Too many login attempts. Please try again at 07:43 PM."

    it("says to wait when there have been too many tries, at either step", () => {
        expect(signInErrorKey(tooMany)).toBe("error_too_many_attempts")
        expect(codeErrorKey(tooMany, "app")).toBe("error_too_many_attempts")
    })

    it("says to wait 30 seconds after five wrong tries, at either step (decided 2026-11-03)", () => {
        const paused = "Sign-in paused for 30 seconds after five wrong tries for this account."
        expect(signInErrorKey(paused)).toBe("error_sign_in_paused")
        expect(codeErrorKey(paused, "app")).toBe("error_sign_in_paused")
        expect(en.error_sign_in_paused).toContain("30 seconds")
        expect(ar.error_sign_in_paused).toContain("٣٠ ثانية")
        // Said to anybody, not told to a man to wait (PR 183).
        expect(ar.error_sign_in_paused).not.toContain("انتظر")
    })

    it("says why an account with the right password can't sign in", () => {
        expect(signInErrorKey("Your account has been suspended or deleted.")).toBe("error_suspended")
        expect(signInErrorKey("Company access restricted. Please contact support.")).toBe("error_banned")
        expect(signInErrorKey("This company's subscription has expired. Please contact your administrator.")).toBe("error_subscription_expired")
        expect(signInErrorKey("This account is closed. Please contact your administrator.")).toBe("error_account_closed")
        expect(signInErrorKey("This user does not belong to the selected company.")).toBe("error_access_denied")
    })

    it("keeps a wrong email or password vague", () => {
        expect(signInErrorKey("CredentialsSignin")).toBe("error_invalid_credentials")
        // A wrong code says what to do next, as Security settings does
        // (DESIGN.md §5.5, Sign-in): it was "Invalid code".
        expect(codeErrorKey("INVALID_MFA_CODE", "app")).toBe("security_mfa_code_wrong")
        expect(codeErrorKey("INVALID_MFA_CODE", "email")).toBe("sign_in_email_code_wrong")
        expect(codeErrorKey(undefined, "app")).toBe("error_generic")
    })

    it("exists in English and Arabic", () => {
        for (const key of ["error_too_many_attempts", "error_subscription_expired", "error_account_closed", "error_access_denied", "security_mfa_code_wrong", "sign_in_email_code_wrong"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })
})
