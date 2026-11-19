import type { TranslationKey } from '@/lib/translations'
import { newPasswordErrors } from '@/lib/new-password-form'

/**
 * Change password in the client's area's checks (CLIENT_PORTAL_PLAN.md §5.3,
 * §12 step 7d-2; PR 335), before anything is sent, each under its field in
 * the reader's language, as the company's people's Change password checks its
 * own (lib/new-password-form.ts); and what the server's refusals say.
 */

/** Its fields in the order they're in, for the first one wrong to take the focus. */
export const PORTAL_PASSWORD_FIELDS = ['currentPassword', 'newPassword', 'confirmPassword'] as const
export type PortalPasswordField = (typeof PORTAL_PASSWORD_FIELDS)[number]

export function portalPasswordErrors(typed: Record<PortalPasswordField, string>): Partial<Record<PortalPasswordField, TranslationKey>> {
    const errors: Partial<Record<PortalPasswordField, TranslationKey>> = {}
    if (!typed.currentPassword) errors.currentPassword = 'portal_password_current_needed'
    return { ...errors, ...newPasswordErrors(typed) }
}

/**
 * What a refused save says, by the server's code: a wrong current password
 * under its field; too many wrong tries, which no one at the office can lift
 * for a client's person, and anything else, above Save.
 */
export function portalPasswordRefusal(answer: { code?: unknown } | null): { field?: PortalPasswordField; key: TranslationKey } {
    if (answer?.code === 'CURRENT_PASSWORD_WRONG') return { field: 'currentPassword', key: 'incorrect_password' }
    if (answer?.code === 'OWN_PASSWORD_TRIES') return { key: 'portal_password_tries' }
    return { key: 'change_password_failed' }
}
