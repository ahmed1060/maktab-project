import type { TranslationKey } from '@/lib/translations'
import { calendarParts } from '@/lib/time'
import { NAME_MAX, PASSWORD_MIN } from '@/lib/new-employee-form'
import { mistakeKey, newNameErrors, type NameLanguage, type TwoNames } from '@/lib/names/name-fields'
import { usernameError } from '@/lib/username-rules'

/**
 * A person's profile form's checks (a person's profile, part 3, PR 193),
 * before anything is sent: each says what's wrong in the reader's language,
 * under its field. They were toasts, one at a time, and the email's still
 * described the rule the server had dropped, "user(max 20)@domain(max 10).com".
 * Its role, and the day an acting one ends, too (part 4, PR 194).
 */

/**
 * Its fields in the order they're in, for the first one wrong to take the
 * focus: each name's in Arabic beside it, where it keeps both (PR 403), put
 * in the page's order by inPageOrder (lib/names/name-fields.ts).
 */
export const PROFILE_FIELDS = ['firstName', 'firstNameAr', 'lastName', 'lastNameAr', 'email', 'username', 'salary', 'dayOffCredit', 'password', 'roleId', 'actingUntil'] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]

/** Above it, a salary is taken for a slip of the finger. */
export const SALARY_MAX = 1_000_000_000

/** A quick check before the round trip; the server checks properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function profileErrors(typed: {
    firstName: string
    lastName: string
    /**
     * Each name in English and in Arabic, where it keeps both (LATER_CHANGES_PLAN.md
     * §3.1, step 4b, PR 403): both needed, each in its own letters, in place
     * of the names above. One saved before in one language is asked for the
     * other here, as its note says.
     */
    names?: { first: TwoNames; last: TwoNames }
    /** Each of these is checked only where it may be changed: one that's off can't be put right. */
    email?: string
    /** Only a changed one is sent. */
    username?: string
    /** Empty keeps the password as it is. */
    password: string
    salary?: string
    dayOffCredit?: string
    /** When an acting role ends, where another role is picked: empty is for good. */
    actingUntil?: string
    /** The first day it may end on: tomorrow. */
    actingFrom?: string
    /**
     * What the browser couldn't read: an amount such as "1e" or "-". Its
     * field reads as empty, which is sent as 0 over what was there. The day
     * an acting role ends is picked on the calendar, so it's never half typed
     * (PR 210).
     */
    unreadable?: readonly ('salary' | 'dayOffCredit')[]
}): Partial<Record<ProfileField, TranslationKey>> {
    const errors: Partial<Record<ProfileField, TranslationKey>> = {}
    // A name can be loaded longer than the route takes now, which its
    // field's limit can't stop: it's said too.
    if (typed.names) {
        const said = (field: 'firstName' | 'lastName', names: TwoNames) => {
            const wrong = newNameErrors(NAME_MAX, names)
            for (const language of ['en', 'ar'] as NameLanguage[]) {
                const mistake = wrong[language]
                if (mistake) errors[language === 'en' ? field : (`${field}Ar` as const)] = mistakeKey(mistake, language)
            }
        }
        said('firstName', typed.names.first)
        said('lastName', typed.names.last)
    } else {
        if (!named(typed.firstName)) errors.firstName = 'profile_first_name_invalid'
        if (!named(typed.lastName)) errors.lastName = 'profile_last_name_invalid'
    }
    if (typed.email !== undefined && !EMAIL.test(typed.email.trim())) errors.email = 'emp_new_email_invalid'
    if (typed.username !== undefined && usernameError(typed.username)) errors.username = 'username_invalid'
    if (typed.salary !== undefined) {
        if (typed.unreadable?.includes('salary') || !zeroOrMore(typed.salary)) errors.salary = 'emp_new_salary_invalid'
        else if (Number(typed.salary) > SALARY_MAX) errors.salary = 'salary_limit_error'
    }
    if (typed.dayOffCredit !== undefined && (typed.unreadable?.includes('dayOffCredit') || !zeroOrMore(typed.dayOffCredit))) errors.dayOffCredit = 'emp_new_day_off_invalid'
    if (typed.password && typed.password.length < PASSWORD_MIN) errors.password = 'emp_new_password_short'
    if (typed.actingUntil !== undefined) {
        const wrong = actingError(typed.actingUntil, typed.actingFrom)
        if (wrong) errors.actingUntil = wrong
    }
    return errors
}

/**
 * Asking for another role from their details (ROLES_PLAN.md §6.12): one that
 * isn't theirs already, and the day it ends, if it's an acting one.
 */
export function roleAskErrors(asked: { roleId: string; current: string; actingUntil: string; actingFrom: string }): Partial<Record<'roleId' | 'actingUntil', TranslationKey>> {
    const wrong = actingError(asked.actingUntil, asked.actingFrom)
    return {
        ...(!asked.roleId || asked.roleId === asked.current ? { roleId: 'profile_role_same' as const } : {}),
        ...(wrong ? { actingUntil: wrong } : {}),
    }
}

/**
 * An acting role ends after today; left empty, the change is for good. The
 * calendar offers no day before it, but the page can stay open past midnight.
 */
function actingError(until: string, from: string | undefined): TranslationKey | null {
    // Dates as the calendar gives them, YYYY-MM-DD, compare as they're written.
    if (until && from && until < from) return 'profile_acting_past'
    return null
}

/**
 * The day after `now` in the company's calendar, as the calendar takes it:
 * the first an acting role may end on. The server reads a return date in that
 * calendar (RoleAssignmentService.returnOn), so a viewer elsewhere, a day
 * ahead or behind, is offered the company's tomorrow, not their own.
 */
export function dayAfter(now: Date, timeZone: string): string {
    const { year, month, day } = calendarParts(now, timeZone)
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
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
 * A role's refusals, by their codes (lib/role-errors.ts), from the profile's
 * save and from asking for a role alike. Who may ask for whom, and one's own
 * role, which the profile doesn't offer, aren't any field's.
 */
const ROLE_REFUSED: Record<string, { field: ProfileField; key: TranslationKey }> = {
    FORBIDDEN_ROLE_ASSIGNMENT: { field: 'roleId', key: 'profile_role_not_given' },
    ROLE_EXCEEDS_YOURS: { field: 'roleId', key: 'profile_role_exceeds' },
    ROLE_NOT_IN_COMPANY: { field: 'roleId', key: 'requests_role_gone' },
    ADMIN_IS_SUPER_ADMINS: { field: 'roleId', key: 'profile_role_admin' },
    SAME_ROLE: { field: 'roleId', key: 'profile_role_same' },
    ALREADY_PENDING: { field: 'roleId', key: 'profile_role_already_asked' },
    LAST_ADMIN: { field: 'roleId', key: 'profile_role_last_admin' },
    ACTING_END_IN_PAST: { field: 'actingUntil', key: 'profile_acting_past' },
}

/**
 * The field a refusal from the server is about, and what to say there.
 * Anything else is said above the buttons.
 */
export function refusedField(body: { error?: string; code?: string; details?: Record<string, unknown> } | null): { field: ProfileField; key: TranslationKey } | null {
    if (!body) return null
    if (body.code && Object.hasOwn(ROLE_REFUSED, body.code)) return ROLE_REFUSED[body.code]
    if (body.error === 'Username in use') return { field: 'username', key: 'username_in_use' }
    if (body.error === USERNAME_RESERVED) return { field: 'username', key: 'username_reserved' }
    if (body.error === 'Email in use') return { field: 'email', key: 'emp_new_email_taken' }
    const details = body.details ?? {}
    // A name, as the route says what's wrong with it: in the other language's
    // letters, or missing where it keeps both (PR 403), or else too long.
    const name = (field: 'firstName' | 'firstNameAr' | 'lastName' | 'lastNameAr', letters: TranslationKey, needed: TranslationKey, long: TranslationKey) => {
        const why = JSON.stringify(details[field])
        return { field, key: why.includes('letters') ? letters : why.includes('Needed') ? needed : long }
    }
    if (details.firstName) return name('firstName', 'name_not_english', 'name_required_en', 'profile_first_name_invalid')
    if (details.firstNameAr) return name('firstNameAr', 'name_not_arabic', 'name_required_ar', 'name_too_long')
    if (details.lastName) return name('lastName', 'name_not_english', 'name_required_en', 'profile_last_name_invalid')
    if (details.lastNameAr) return name('lastNameAr', 'name_not_arabic', 'name_required_ar', 'name_too_long')
    if (details.email) return { field: 'email', key: 'emp_new_email_invalid' }
    if (details.username) return { field: 'username', key: 'username_invalid' }
    if (details.password) return { field: 'password', key: 'emp_new_password_short' }
    if (details.salary) return { field: 'salary', key: 'emp_new_salary_invalid' }
    if (details.baseDayOffCredit) return { field: 'dayOffCredit', key: 'emp_new_day_off_invalid' }
    return null
}
