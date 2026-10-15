import type { TranslationKey } from '@/lib/translations'

/**
 * A count with its word, in the page's language (DESIGN.md §7): "1 day",
 * "3 days"; يوم واحد، يومان، ٣ أيام، ١١ يومًا. The forms are in the translation
 * files as `count_<word>_<form>`, one per plural form that Intl.PluralRules
 * gives (zero, one, two, few, many, other). English only ever picks one and
 * other; Arabic uses all six, and writes one and two without the digit.
 */
export type CountWord = 'days' | 'pts' | 'employees'

export function countOf(t: (key: TranslationKey) => string, locale: string, n: number, word: CountWord): string {
    const lang = locale === 'ar' ? 'ar' : 'en'
    const form = new Intl.PluralRules(lang).select(n)
    const digits = n.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 2 })
    return t(`count_${word}_${form}` as TranslationKey).replace('{n}', digits)
}
