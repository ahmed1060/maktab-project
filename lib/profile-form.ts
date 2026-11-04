import type { TranslationKey } from '@/lib/translations'
import { NAME_MAX, PASSWORD_MIN } from '@/lib/new-employee-form'
import { usernameError } from '@/lib/username-rules'

/**
 * A person's profile form's checks (a person's profile, part 3, PR 193),
 * before anything is sent: each says what's wrong in the reader's language,
 * under its field. They were toasts, one at a time, and the email's still
 * described the rule the server had dropped, "user(max 20)@domain(max 10).com".
 */

/** Its fields in the order they're in, for the first one wrong to take the focus. */
export const PROFILE_FIELDS = ['firstName', 'lastName', 'email', 'username', 'salary', 'dayOffCredit', 'password'] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]

/** Above it, a salary is taken for a slip of the finger. */
export const SALARY_MAX = 1_000_000_000

/** A quick check before the round trip; the server checks properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function profileErrors(typed: {
    firstName: string
    lastName: string
    /** Each of these is checked only where it may be changed: one that's off can't be put right. */
    email?: string
    /** Only a changed one is sent. */
    username?: string
    /** Empty keeps the password as it is. */
    password: string
    salary?: string
    dayOffCredit?: string
}): Partial<Record<ProfileField, TranslationKey>> {
    const errors: Partial<Record<ProfileField, TranslationKey>> = {}
    // A name can be loaded longer than the route takes now, which its
    // field's limit can't stop: it's said too.
    if (!named(typed.firstName)) errors.firstName = 'profile_first_name_invalid'
    if (!named(typed.lastName)) errors.lastName = 'profile_last_name_invalid'
    if (typed.email !== undefined && !EMAIL.test(typed.email.trim())) errors.email = 'emp_new_email_invalid'
    if (typed.username !== undefined && usernameError(typed.username)) errors.username = 'username_invalid'
    if (typed.salary !== undefined) {
        if (!zeroOrMore(typed.salary)) errors.salary = 'emp_new_salary_invalid'
        else if (Number(typed.salary) > SALARY_MAX) errors.salary = 'salary_limit_error'
    }
    if (typed.dayOffCredit !== undefined && !zeroOrMore(typed.dayOffCredit)) errors.dayOffCredit = 'emp_new_day_off_invalid'
    if (typed.password && typed.password.length < PASSWORD_MIN) errors.password = 'emp_new_password_short'
    return errors
}

const named = (name: string) => name.trim().length > 0 && name.trim().length <= NAME_MAX

/** Left empty is fine (it's sent as 0); otherwise a number, 0 or more. */
function zeroOrMore(text: string): boolean {
    const typed = text.trim()
    if (!typed) return true
    const n = Number(typed)
    return Number.isFinite(n) && n >= 0
}

/** As the route says it (app/api/users/route.ts). */
const USERNAME_RESERVED = "Username follows another company's username code"

/**
 * The field a refusal from the server is about, and what to say there.
 * Anything else is said above the buttons.
 */
export function refusedField(body: { error?: string; details?: Record<string, unknown> } | null): { field: ProfileField; key: TranslationKey } | null {
    if (!body) return null
    if (body.error === 'Username in use') return { field: 'username', key: 'username_in_use' }
    if (body.error === USERNAME_RESERVED) return { field: 'username', key: 'username_reserved' }
    const details = body.details ?? {}
    if (details.firstName) return { field: 'firstName', key: 'profile_first_name_invalid' }
    if (details.lastName) return { field: 'lastName', key: 'profile_last_name_invalid' }
    if (details.email) return { field: 'email', key: 'emp_new_email_invalid' }
    if (details.username) return { field: 'username', key: 'username_invalid' }
    if (details.password) return { field: 'password', key: 'emp_new_password_short' }
    if (details.salary) return { field: 'salary', key: 'emp_new_salary_invalid' }
    if (details.baseDayOffCredit) return { field: 'dayOffCredit', key: 'emp_new_day_off_invalid' }
    return null
}
