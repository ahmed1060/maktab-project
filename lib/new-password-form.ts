import type { TranslationKey } from '@/lib/translations'
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/new-employee-form'

/**
 * Change password's checks (UI_PLAN.md §5 step 5, the pages left), before
 * anything is sent: each under its field, in the reader's language. They were
 * toasts, typed into the page in both languages.
 *
 * As long as the server takes (lib/validations/user.schema.ts): the fields
 * stop at PASSWORD_MAX, so only too short is said.
 */
export { PASSWORD_MAX, PASSWORD_MIN }

/** Its fields in the order they're in, for the first one wrong to take the focus. */
export const NEW_PASSWORD_FIELDS = ['newPassword', 'confirmPassword'] as const
export type NewPasswordField = (typeof NEW_PASSWORD_FIELDS)[number]

export function newPasswordErrors(typed: { newPassword: string; confirmPassword: string }): Partial<Record<NewPasswordField, TranslationKey>> {
    const errors: Partial<Record<NewPasswordField, TranslationKey>> = {}
    if (typed.newPassword.length < PASSWORD_MIN) errors.newPassword = 'change_password_short'
    if (typed.confirmPassword !== typed.newPassword) errors.confirmPassword = 'change_password_mismatch'
    return errors
}
