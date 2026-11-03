import type { TranslationKey } from '@/lib/translations'

/**
 * Add employee's checks (UI_PLAN.md §5 step 5), before anything is sent:
 * each says what's wrong in the reader's language, under its field. They
 * were in English whatever the language, and the email's still described
 * the rule it had dropped, "user(max 20)@domain(max 10).com".
 */

/** As the server takes them (lib/validations/user.schema.ts). */
export const NAME_MAX = 15
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 72
/** A quick check before the round trip; the server checks properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Its fields in the order they're in, for the first one wrong to take the focus. */
export const FIELDS = ['firstName', 'lastName', 'email', 'password', 'companyId', 'salary', 'dayOffCredit'] as const
export type NewEmployeeField = (typeof FIELDS)[number]

export function newEmployeeErrors(typed: {
    firstName: string
    lastName: string
    email: string
    password: string
    /** The Super Admin says which company; anyone else adds to their own. */
    company: { needed: boolean; id: string }
    /**
     * Each checked only where the form asks for it, by the role picked. The
     * form takes over the browser's own checks (noValidate), so their min={0}
     * no longer stopped a negative one (Codex review on PR 180).
     */
    salary?: { shown: boolean; text: string }
    dayOffCredit?: { shown: boolean; text: string }
}): Partial<Record<NewEmployeeField, TranslationKey>> {
    const errors: Partial<Record<NewEmployeeField, TranslationKey>> = {}
    if (!typed.firstName.trim()) errors.firstName = 'emp_new_first_name_required'
    if (!typed.lastName.trim()) errors.lastName = 'emp_new_last_name_required'
    if (!EMAIL.test(typed.email.trim())) errors.email = 'emp_new_email_invalid'
    if (typed.password.length < PASSWORD_MIN) errors.password = 'emp_new_password_short'
    if (typed.company.needed && !typed.company.id) errors.companyId = 'emp_new_company_required'
    if (typed.salary?.shown && !zeroOrMore(typed.salary.text)) errors.salary = 'emp_new_salary_invalid'
    if (typed.dayOffCredit?.shown && !zeroOrMore(typed.dayOffCredit.text)) errors.dayOffCredit = 'emp_new_day_off_invalid'
    return errors
}

/** Left empty is fine (the server counts it as 0); otherwise a number, 0 or more. */
function zeroOrMore(text: string): boolean {
    const typed = text.trim()
    if (!typed) return true
    const n = Number(typed)
    return Number.isFinite(n) && n >= 0
}

/**
 * The field a refusal from the server is about, and what to say there: an
 * email somebody already has under the email, where it was said above the
 * form, or not at all ("Username already in use" was never what the server
 * says). Anything else is said above the buttons.
 */
export function refusedField(body: { error?: string; details?: Record<string, unknown> } | null): { field: NewEmployeeField; key: TranslationKey } | null {
    if (!body) return null
    if (body.error === 'User already exists') return { field: 'email', key: 'emp_new_email_taken' }
    const details = body.details ?? {}
    if (details.email) return { field: 'email', key: 'emp_new_email_invalid' }
    if (details.password) return { field: 'password', key: 'emp_new_password_short' }
    if (details.firstName) return { field: 'firstName', key: 'emp_new_first_name_required' }
    if (details.lastName) return { field: 'lastName', key: 'emp_new_last_name_required' }
    if (details.salary) return { field: 'salary', key: 'emp_new_salary_invalid' }
    if (details.dayOffCredit) return { field: 'dayOffCredit', key: 'emp_new_day_off_invalid' }
    return null
}
