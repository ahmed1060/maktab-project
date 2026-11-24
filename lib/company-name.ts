import type { Locale, TranslationKey } from '@/lib/translations'
import { missingLanguages, nameIn } from '@/lib/names'
import { mistakeKey, newNameErrors, type NameLanguage, type TwoNames } from '@/lib/names/name-fields'

/**
 * The company's name in English and in Arabic (LATER_CHANGES_PLAN.md §3.1,
 * step 7a, PR 408; DESIGN.md §5.3), in the Super Admin's Add company and
 * Edit company dialog: checked before it's sent, as the server takes it
 * (lib/validations/company.schema.ts).
 */

// 2 to 50 characters in each language, as the name has until now: its
// username code is suggested from 2 letters at least.
export const COMPANY_NAME_MIN = 2
export const COMPANY_NAME_MAX = 50

export type CompanyNameField = 'name' | 'nameAr'

/** What's wrong with each language of the name, under its field. */
export function companyNameErrors(names: TwoNames): Partial<Record<CompanyNameField, TranslationKey>> {
    const wrong = newNameErrors(COMPANY_NAME_MAX, names)
    const errors: Partial<Record<CompanyNameField, TranslationKey>> = {}
    for (const language of ['en', 'ar'] as NameLanguage[]) {
        const field: CompanyNameField = language === 'en' ? 'name' : 'nameAr'
        const typed = names[language].trim()
        const mistake = wrong[language]
        if (mistake) errors[field] = mistakeKey(mistake, language)
        else if (typed.length < COMPANY_NAME_MIN) errors[field] = 'companies_name_short'
    }
    return errors
}

/** What a mistake says: "the company name", and its limit in the reader's digits. */
export function companyMistakeText(t: (key: TranslationKey) => string, locale: string, key: TranslationKey): string {
    return t(key).replace('{name}', t('company_name_in_sentence')).replace('{max}', COMPANY_NAME_MAX.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB'))
}

/**
 * The field a refusal of the name is about, and what to say there: one the
 * schema refused (lib/validations/arabic-name.schema.ts, nameIn), or a name
 * another company has in either language. Anything else isn't the name's.
 */
export function companyRefusedField(body: { error?: string; details?: Record<string, unknown> } | null): { field: CompanyNameField; key: TranslationKey } | null {
    if (body?.error === 'Company name in Arabic already exists') return { field: 'nameAr', key: 'companies_name_taken' }
    if (body?.error?.endsWith('already exists')) return { field: 'name', key: 'companies_name_taken' }
    const details = body?.details ?? {}
    for (const field of ['name', 'nameAr'] as const) {
        if (!details[field]) continue
        const said = JSON.stringify(details[field])
        const language: NameLanguage = field === 'nameAr' ? 'ar' : 'en'
        if (said.includes('Needed')) return { field, key: mistakeKey('required', language) }
        if (said.includes('letters')) return { field, key: mistakeKey(language === 'en' ? 'not_english' : 'not_arabic', language) }
        if (said.includes('Too short')) return { field, key: 'companies_name_short' }
        return { field, key: 'name_too_long' }
    }
    return null
}

/** The note at the top of an edited company's dialog, while its name is in one language only (DESIGN.md §5.3). */
export function companyMissingNote(company: { name: string; nameAr?: string | null }): TranslationKey | null {
    const missing = missingLanguages([{ en: company.name, ar: company.nameAr }])
    if (missing.length > 1) return 'name_missing_both_note'
    if (missing[0] === 'ar') return 'name_missing_ar_note'
    return missing[0] === 'en' ? 'name_missing_en_note' : null
}

/**
 * The company's name in the page's language, or in the one it has while it
 * has only one (DESIGN.md §5.3; LATER_CHANGES_PLAN.md §3.1, step 7b, PR 409).
 */
export function companyNameIn(locale: Locale, company: { name: string; nameAr?: string | null }): string {
    return nameIn(locale, { en: company.name, ar: company.nameAr })
}

/** The session's company's name in the page's language, as above; nothing for a session with no company. */
export function sessionCompanyName(locale: Locale, user: { companyName?: string | null; companyNameAr?: string | null }): string | null {
    return user.companyName ? companyNameIn(locale, { name: user.companyName, nameAr: user.companyNameAr }) : null
}
