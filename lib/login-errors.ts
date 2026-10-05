import type { en } from "@/lib/translations/en"

type MessageKey = keyof typeof en

/**
 * The message the sign-in page shows for an error authorize() sent back.
 * Found on production: everything that wasn't suspended or banned read
 * "Invalid email or password", so a Super Admin who had been told to wait out
 * the five-tries limit believed their account was locked and kept trying.
 * The account-state messages only ever reach someone who gave the right
 * password (lib/auth.ts), so saying them gives nothing away.
 */
export function signInErrorKey(error: string): MessageKey {
    if (error.includes("Too many login attempts")) return "error_too_many_attempts"
    if (error.includes("suspended")) return "error_suspended"
    if (error.includes("Company access restricted")) return "error_banned"
    if (error.includes("subscription has expired")) return "error_subscription_expired"
    if (error.includes("account is closed")) return "error_account_closed"
    if (error.includes("This user does not belong")) return "error_access_denied"
    return "error_invalid_credentials"
}

/** The same, for the step that asks for the two-factor code. */
export function codeErrorKey(error: string | undefined | null): MessageKey {
    if (error === "INVALID_MFA_CODE") return "error_invalid_code"
    if (error?.includes("Too many login attempts")) return "error_too_many_attempts"
    return "error_generic"
}
