import type { TranslationKey } from '@/lib/translations'

/**
 * Security settings' checks (UI_PLAN.md §5 step 5, the pages left), before
 * anything is sent: each said under its field in the reader's language. The
 * server's own refusals of these were "Validation Error", in English.
 *
 * As the server takes them (lib/validations/email-verification.schema.ts,
 * mfa.schema.ts): an email of up to 254 characters, and a code of six. The
 * codes it sends and the authenticator apps show are digits.
 */

export const EMAIL_MAX = 254
export const CODE_LENGTH = 6

/** A quick check before the round trip; the server checks properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE = /^\d{6}$/

/** What's wrong with an email as typed, or nothing. */
export function emailError(typed: string): TranslationKey | null {
    const email = typed.trim()
    return EMAIL.test(email) && email.length <= EMAIL_MAX ? null : 'security_email_invalid'
}

/** Whether a code as typed is six digits. */
export function isCode(typed: string): boolean {
    return CODE.test(typed.trim())
}
