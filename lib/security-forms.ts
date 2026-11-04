import { apiErrorText } from '@/lib/api-error-text'
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

/** The form a refusal answered: sending a code, verifying it, a two-factor code, the password to turn it off. */
export type RefusedForm = 'send' | 'verify' | 'mfaCode' | 'password'

/** The server's "Validation Error", said as each form's own check says it. */
const MALFORMED: Record<RefusedForm, TranslationKey> = {
    send: 'security_email_invalid',
    verify: 'security_email_code_invalid',
    mfaCode: 'security_mfa_code_invalid',
    password: 'security_mfa_password_missing',
}

/**
 * What to say under the field when the server refuses, in the reader's
 * language, with what to do next. The routes answer in English
 * (app/api/account/email/*, mfa/*), and their words came as they were: a
 * wrong code read "Invalid or expired code" in Arabic too. These are the
 * refusals a person meets; anything else is said as the server put it, or the
 * screen's fallback (apiErrorText).
 */
export function refusalText(form: RefusedForm, status: number, text: string, t: (key: TranslationKey) => string): string {
    let error: unknown
    try {
        error = JSON.parse(text)?.error
    } catch {
        error = undefined
    }
    const key = refusalKey(form, status, error)
    return key ? t(key) : apiErrorText(text, t('error_generic'))
}

function refusalKey(form: RefusedForm, status: number, error: unknown): TranslationKey | null {
    if (error === 'Validation Error') return MALFORMED[form]
    if (error === 'Email already in use' && (form === 'send' || form === 'verify')) return 'security_email_taken'
    if (form === 'send' && status === 429) return 'security_code_too_many'
    if (form === 'verify' && error === 'Invalid or expired code') return 'security_email_code_wrong'
    if (form === 'mfaCode' && typeof error === 'string' && error.startsWith('Invalid code')) return 'security_mfa_code_wrong'
    if (form === 'password' && error === 'Incorrect password') return 'security_mfa_password_wrong'
    return null
}
