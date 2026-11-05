import type { TranslationKey } from '@/lib/translations'
import { isCode } from '@/lib/security-forms'

/**
 * The sign-in page's checks (DESIGN.md §5.5, Sign-in), before anything is
 * sent: each said under its field in the reader's language, where the
 * browser's own bubble said it in its own language, or not at all.
 *
 * As the server takes them (lib/auth.ts): an email or a username of up to 254
 * characters, and a password of up to 72, bcrypt's limit. A password is never
 * trimmed: spaces may be part of it.
 */

export const IDENTIFIER_MAX = 254
export const PASSWORD_MAX = 72

export type SignInField = 'identifier' | 'password'

/** What's missing from the first step, field by field, or nothing. */
export function signInErrors({ identifier, password }: { identifier: string; password: string }): Partial<Record<SignInField, TranslationKey>> {
    const wrong: Partial<Record<SignInField, TranslationKey>> = {}
    if (!identifier.trim()) wrong.identifier = 'sign_in_identifier_needed'
    if (!password) wrong.password = 'sign_in_password_needed'
    return wrong
}

/** Where the code comes from: the authenticator app, or an email sent instead. */
export type CodeKind = 'app' | 'email'

/** A code that isn't six digits, said as where it came from says it, as Security settings does. */
export function codeError(code: string, kind: CodeKind): TranslationKey | null {
    if (isCode(code)) return null
    return kind === 'app' ? 'security_mfa_code_invalid' : 'security_email_code_invalid'
}

/**
 * "Email me a code instead" turned down, by the code the server answers with
 * (app/api/auth/mfa-recovery/request/route.ts). Its words came in English;
 * anything not here is said as the server put it.
 */
const EMAIL_CODE_REFUSALS: Record<string, TranslationKey> = {
    // The password was right a step ago: it was changed meanwhile.
    WRONG_PASSWORD: 'error_invalid_credentials',
    NO_EMAIL_CODES: 'sign_in_email_code_unavailable',
    TOO_MANY_CODES: 'security_code_too_many',
}

export function emailCodeRefusal(code: unknown): TranslationKey | null {
    return typeof code === 'string' && Object.hasOwn(EMAIL_CODE_REFUSALS, code) ? EMAIL_CODE_REFUSALS[code] : null
}
