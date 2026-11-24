import type { TranslationKey } from '@/lib/translations'
import { mistakeKey, newNameErrors } from '@/lib/names/name-fields'

/**
 * Add employee's checks (UI_PLAN.md §5 step 5), before anything is sent:
 * each says what's wrong in the reader's language, under its field. They
 * were in English whatever the language, and the email's still described
 * the rule it had dropped, "user(max 20)@domain(max 10).com".
 */

// A first or a last name, as the server takes them (lib/validations/user.schema.ts):
// up to 30 characters (the owner's answer of 2026-11-24, PR 402; it was 15, then
// 40 from PR 397). A first or last name is mostly one word, and at worst a
// compound of two, which fits even spaced: Abd El Moneim Abd El Ghaffar is 28.
export const NAME_MAX = 30
// 8 to 72 characters wherever a password is set (the owner's answer of
// 2026-11-20, PR 341; it was 12). bcrypt reads no more than 72 bytes.
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72
/** A quick check before the round trip; the server checks properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Its fields in the order they're in, for the first one wrong to take the focus. */
export const FIELDS = ['firstName', 'firstNameAr', 'lastName', 'lastNameAr', 'email', 'password', 'companyId', 'salary', 'dayOffCredit'] as const
export type NewEmployeeField = (typeof FIELDS)[number]

/** Its fields in the order the page shows them: each name's in the page's language first (PR 402). */
export function fieldsInFormOrder(locale: string): readonly NewEmployeeField[] {
    if (locale !== 'ar') return FIELDS
    return FIELDS.map(field => ({ firstName: 'firstNameAr', firstNameAr: 'firstName', lastName: 'lastNameAr', lastNameAr: 'lastName' } as Partial<Record<NewEmployeeField, NewEmployeeField>>)[field] ?? field)
}

/** A name's field and which name it's of, for its words: "Enter the first name in Arabic." */
export const NAME_OF: Partial<Record<NewEmployeeField, TranslationKey>> = {
    firstName: 'first_name_in_sentence', firstNameAr: 'first_name_in_sentence',
    lastName: 'last_name_in_sentence', lastNameAr: 'last_name_in_sentence',
}

/** What a mistake says under its field: a name's with which name it's of, and its limit in the reader's digits. */
export function mistakeText(t: (key: TranslationKey) => string, locale: string, field: NewEmployeeField, key: TranslationKey): string {
    const of = NAME_OF[field]
    return (of ? t(key).replace('{name}', t(of)) : t(key)).replace('{max}', NAME_MAX.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB'))
}

export function newEmployeeErrors(typed: {
    /** Each name in English and in Arabic, both needed (PR 402). */
    firstName: string
    firstNameAr: string
    lastName: string
    lastNameAr: string
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
    /**
     * The number fields the browser couldn't read ("1e", "-"): it gives them
     * as empty, as though left empty, which the server takes as 0. Asked of
     * the fields themselves (validity.badInput), as the profile form does.
     */
    unreadable?: readonly ('salary' | 'dayOffCredit')[]
}): Partial<Record<NewEmployeeField, TranslationKey>> {
    const errors: Partial<Record<NewEmployeeField, TranslationKey>> = {}
    const first = newNameErrors(NAME_MAX, { en: typed.firstName, ar: typed.firstNameAr })
    const last = newNameErrors(NAME_MAX, { en: typed.lastName, ar: typed.lastNameAr })
    if (first.en) errors.firstName = mistakeKey(first.en, 'en')
    if (first.ar) errors.firstNameAr = mistakeKey(first.ar, 'ar')
    if (last.en) errors.lastName = mistakeKey(last.en, 'en')
    if (last.ar) errors.lastNameAr = mistakeKey(last.ar, 'ar')
    if (!EMAIL.test(typed.email.trim())) errors.email = 'emp_new_email_invalid'
    if (typed.password.length < PASSWORD_MIN) errors.password = 'emp_new_password_short'
    if (typed.company.needed && !typed.company.id) errors.companyId = 'emp_new_company_required'
    if (typed.salary?.shown && (typed.unreadable?.includes('salary') || !zeroOrMore(typed.salary.text))) errors.salary = 'emp_new_salary_invalid'
    if (typed.dayOffCredit?.shown && (typed.unreadable?.includes('dayOffCredit') || !zeroOrMore(typed.dayOffCredit.text))) errors.dayOffCredit = 'emp_new_day_off_invalid'
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
    // A name the form let through and the server didn't: in the other language's letters, or too
    // long, as a suggestion used may be (PR 402).
    const name = (field: 'firstName' | 'firstNameAr' | 'lastName' | 'lastNameAr', letters: TranslationKey) =>
        ({ field, key: JSON.stringify(details[field]).includes('letters') ? letters : 'name_too_long' as TranslationKey })
    if (details.firstName) return name('firstName', 'name_not_english')
    if (details.firstNameAr) return name('firstNameAr', 'name_not_arabic')
    if (details.lastName) return name('lastName', 'name_not_english')
    if (details.lastNameAr) return name('lastNameAr', 'name_not_arabic')
    if (details.salary) return { field: 'salary', key: 'emp_new_salary_invalid' }
    if (details.dayOffCredit) return { field: 'dayOffCredit', key: 'emp_new_day_off_invalid' }
    return null
}
