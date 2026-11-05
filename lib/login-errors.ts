import type { en } from "@/lib/translations/en"

type MessageKey = keyof typeof en

/**
 * The message the sign-in page shows for an error authorize() sent back.
 * Found on production: everything that wasn't suspended or banned read
 * "Invalid email or password", so a Super Admin who had been told to wait out
 * the limit on wrong tries believed their account was locked and kept trying.
 * The account-state messages only ever reach someone who gave the right
 * password (lib/auth.ts), so saying them gives nothing away.
 */
export function signInErrorKey(error: string): MessageKey {
    if (error.includes("Sign-in paused")) return "error_sign_in_paused"
    if (error.includes("Too many login attempts")) return "error_too_many_attempts"
    if (error.includes("suspended")) return "error_suspended"
    if (error.includes("Company access restricted")) return "error_banned"
    if (error.includes("subscription has expired")) return "error_subscription_expired"
    if (error.includes("account is closed")) return "error_account_closed"
    if (error.includes("This user does not belong")) return "error_access_denied"
    return "error_invalid_credentials"
}

/** A two-factor code the server turned down, said under the code (DESIGN.md §5.5, Sign-in). */
export function isWrongCode(error: string | undefined | null): boolean {
    return error === "INVALID_MFA_CODE"
}

/**
 * The same, for the step that asks for the two-factor code: a code that isn't
 * right as where it came from says it, as Security settings does, and with
 * what to do next; anything else as the first step says it. Everything but a
 * wrong code was "Something went wrong" here, an account suspended meanwhile
 * included, and a wrong code was "Invalid code".
 */
export function codeErrorKey(error: string | undefined | null, kind: "app" | "email"): MessageKey {
    if (isWrongCode(error)) return kind === "app" ? "security_mfa_code_wrong" : "sign_in_email_code_wrong"
    if (!error) return "error_generic"
    return signInErrorKey(error)
}

/** Held back after wrong tries, and for how many seconds more, as the server counted them (lib/sign-in-lock.ts, holdMessage). */
export type Wait = { kind: "pause" | "lock"; seconds: number }

export function waitOf(error: string | undefined | null): Wait | null {
    const found = /\[wait (\d+)\]/.exec(error ?? "")
    if (!found || !error) return null
    if (error.includes("Sign-in paused")) return { kind: "pause", seconds: Number(found[1]) }
    if (error.includes("Too many login attempts")) return { kind: "lock", seconds: Number(found[1]) }
    return null
}

/** The time left as minutes and seconds, "0:27" or "14:32", in the language's digits; part of a second is a second. */
export function waitText(ms: number, locale: string): string {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const tag = locale === "ar" ? "ar-EG" : "en-GB"
    const minutes = Math.floor(total / 60).toLocaleString(tag)
    const seconds = (total % 60).toLocaleString(tag, { minimumIntegerDigits: 2 })
    return `${minutes}:${seconds}`
}
