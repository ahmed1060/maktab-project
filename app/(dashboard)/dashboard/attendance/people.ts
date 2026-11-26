import { nameIn, namedInOrder } from '@/lib/names'
import type { Locale } from '@/lib/translations'

/**
 * Somebody whose attendance the viewer sees, as /api/attendance/people lists
 * them: their name in English, and in Arabic where they have one
 * (LATER_CHANGES_PLAN.md §3.1, step 8h, PR 419).
 */
export type Person = { id: string; name: string; nameAr?: string | null; teamLeaderId: string | null }

/**
 * The people as a Person select's choices (PR 419): each in the page's
 * language, or in the one they have while they have only one, in the page's
 * order. On an Arabic page, those with an Arabic name first, in Arabic order,
 * then the rest as they came.
 */
export function personChoices(people: readonly Person[], locale: Locale): { value: string; label: string }[] {
    return namedInOrder(people, locale).map(x => ({ value: x.id, label: nameIn(locale, { en: x.name, ar: x.nameAr }) }))
}
