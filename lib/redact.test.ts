import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { redactSecrets } from "./redact"

/**
 * What the audit log keeps of a request's body (withStandardHandler's
 * `audit`). It hid five names, as written: a temporary password's route
 * sends the Admin's own as confirmPassword, which it kept as typed (PR 229).
 * No temporary password had been given in production yet.
 */

describe("a request's body, as the audit log keeps it", () => {
    it("hides the names it hid", () => {
        expect(redactSecrets({ password: "a", passcode: "b", token: "c", secret: "d", plainPassword: "e" })).toEqual({
            password: "[REDACTED]", passcode: "[REDACTED]", token: "[REDACTED]", secret: "[REDACTED]", plainPassword: "[REDACTED]",
        })
    })

    it("hides one's own password confirming a temporary one, and any other name with a password, passcode, token or secret in it", () => {
        expect(redactSecrets({ confirmPassword: "admins-own", currentPassword: "x", newPassword: "y", resetToken: "z", clientSecret: "w", MFA_PASSCODE: "v" })).toEqual({
            confirmPassword: "[REDACTED]", currentPassword: "[REDACTED]", newPassword: "[REDACTED]", resetToken: "[REDACTED]", clientSecret: "[REDACTED]", MFA_PASSCODE: "[REDACTED]",
        })
    })

    it("hides them inside what's sent too, and keeps the rest as sent", () => {
        expect(redactSecrets({ reason: "Audit week", user: { email: "m@x.test", password: "p" }, list: [{ token: "t", id: 1 }] })).toEqual({
            reason: "Audit week", user: { email: "m@x.test", password: "[REDACTED]" }, list: [{ token: "[REDACTED]", id: 1 }],
        })
        expect(redactSecrets(null)).toBeNull()
    })

    it("is what the audit log is given", () => {
        const handler = readFileSync("lib/api-utils.ts", "utf8")
        expect(handler).toContain("const sanitizedBody = redactSecrets(body)")
        expect(handler).not.toContain("const sensitiveKeys = ")
    })
})
