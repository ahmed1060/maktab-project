import type { TranslationKey } from '@/lib/translations'
import { missingLanguages } from '@/lib/names'
import { mistakeKey, newNameErrors, type NameLanguage, type TwoNames } from '@/lib/names/name-fields'

/**
 * A client's names in its form (LATER_CHANGES_PLAN.md §3.1, step 6a, PR 406;
 * DESIGN.md §5.3): its own name and its owner's, each in English and in
 * Arabic, checked before they're sent, as the server takes them
 * (lib/validations/client.schema.ts). The dialog on the Clients page draws
 * them with components/ui/NameFields.tsx.
 */

// The owner's answer of 2026-11-24: a client's name up to 100 characters, as
// before, as a business's name can be long; its owner's up to 60, a person's
// whole name, a first and a last name of 30 each (lib/new-employee-form.ts).
export const CLIENT_NAME_MAX = 100
export const OWNER_NAME_MAX = 60

/** Each name's two fields: its English, and with "Ar" its Arabic. */
export type ClientNameField = 'name' | 'nameAr' | 'ownerName' | 'ownerNameAr'
export type ClientNames = { name: TwoNames; owner: TwoNames }

const NAMES = [
    { field: 'name', of: 'name', max: CLIENT_NAME_MAX, inSentence: 'client_name_in_sentence' },
    { field: 'ownerName', of: 'owner', max: OWNER_NAME_MAX, inSentence: 'owner_name_in_sentence' },
] as const
const nameOf = (field: string) => NAMES.find(name => field === name.field || field === `${name.field}Ar`)

/** What's wrong with each name, under its field: both languages needed, each up to its own limit and in its own letters. */
export function clientNameErrors(names: ClientNames): Partial<Record<ClientNameField, TranslationKey>> {
    const errors: Partial<Record<ClientNameField, TranslationKey>> = {}
    for (const { field, of, max } of NAMES) {
        const wrong = newNameErrors(max, names[of])
        for (const language of ['en', 'ar'] as NameLanguage[]) {
            const mistake = wrong[language]
            if (mistake) errors[language === 'en' ? field : (`${field}Ar` as const)] = mistakeKey(mistake, language)
        }
    }
    return errors
}

/** What a mistake says: with which name it's of, "the client name", and its limit in the reader's digits. */
export function clientMistakeText(t: (key: TranslationKey) => string, locale: string, field: string, key: TranslationKey): string {
    const name = nameOf(field)
    const said = name ? t(key).replace('{name}', t(name.inSentence)) : t(key)
    return name ? said.replace('{max}', name.max.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')) : said
}

/**
 * The note at the top of an edited client's form (DESIGN.md §5.3): which
 * name was saved in one language only, and is asked for in the other. None
 * where both are in both.
 */
export function missingNote(client: { name: string; nameAr?: string | null; ownerName: string; ownerNameAr?: string | null }): TranslationKey | null {
    const name = missingLanguages([{ en: client.name, ar: client.nameAr }]).length > 0
    const owner = missingLanguages([{ en: client.ownerName, ar: client.ownerNameAr }]).length > 0
    if (name && owner) return 'client_names_missing_note'
    if (name) return 'client_name_missing_note'
    return owner ? 'owner_name_missing_note' : null
}

/**
 * The field a refusal from the server is about, and what to say there, as
 * the server says it (lib/validations/arabic-name.schema.ts, nameIn): a name
 * needed, in the other language's letters, or too long. Anything else is
 * said above the form.
 */
export function clientRefusedField(body: { error?: string; details?: Record<string, unknown> } | null): { field: ClientNameField; key: TranslationKey } | null {
    const details = body?.details ?? {}
    for (const field of ['name', 'nameAr', 'ownerName', 'ownerNameAr'] as const) {
        if (!details[field]) continue
        const said = JSON.stringify(details[field])
        const language: NameLanguage = field.endsWith('Ar') ? 'ar' : 'en'
        if (said.includes('Needed')) return { field, key: mistakeKey('required', language) }
        if (said.includes('letters')) return { field, key: mistakeKey(language === 'en' ? 'not_english' : 'not_arabic', language) }
        return { field, key: 'name_too_long' }
    }
    return null
}

/** Ready to save once each name has a language and the phone number is typed; what's still wrong is said on saving. */
export function readyToSave(form: ClientNames & { mobileNumber: string }): boolean {
    const named = (name: TwoNames) => !!(name.en.trim() || name.ar.trim())
    return named(form.name) && named(form.owner) && !!form.mobileNumber.trim()
}
