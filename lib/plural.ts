import type { TranslationKey } from '@/lib/translations'

/**
 * A count with its word, in the page's language (DESIGN.md §7): "1 day",
 * "3 days"; يوم واحد، يومان، ٣ أيام، ١١ يومًا. The forms are in the translation
 * files as `count_<word>_<form>`, one per plural form that Intl.PluralRules
 * gives (zero, one, two, few, many, other). English only ever picks one and
 * other; Arabic uses all six, and writes one and two without the digit.
 * A negative count (points can go below nothing) always shows its digits.
 */
export type CountWord = 'days' | 'pts' | 'employees' | 'requests' | 'records' | 'files' | 'clients' | 'locations' | 'names' | 'times' | 'charges' | 'entries' | 'tasks' | 'obligations'

export function countOf(t: (key: TranslationKey) => string, locale: string, n: number, word: CountWord): string {
    const lang = locale === 'ar' ? 'ar' : 'en'
    const form = new Intl.PluralRules(lang).select(n)
    const digits = n.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 2 })
    let words = t(`count_${word}_${form}` as TranslationKey)
    // The forms that write the number out ("1 pt", نقطتان) are for 1 and 2.
    // Intl.PluralRules gives -1 and -2 the same forms, so a negative count
    // would lose its sign; it takes the form with the digits instead.
    if (n < 0 && !words.includes('{n}')) words = t(`count_${word}_other` as TranslationKey)
    return words.replace('{n}', digits)
}
