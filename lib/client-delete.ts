import type { TranslationKey } from "@/lib/translations"

/**
 * What deleting a client says, on the Clients list (CLIENTS_PLAN.md §4.3;
 * CLIENT_PORTAL_PLAN.md §3.6; PR 313, PR 329): whether Delete archives it
 * instead, what's asked first, what's said once it's done, and what Delete
 * permanently asks, saying what goes with it.
 */

/** What the list knows of a client, as the clients route gives it. */
export type Deletable = {
    name: string
    /** It has tasks or records. */
    inUse?: boolean
    /** It has a tax position: a file uploaded for it, with claims open or none. */
    hasTax?: boolean
    /** How many of its claims are open, for whoever may see tax positions. */
    taxClaims?: number
    /** It has people who can sign in (PR 329). */
    hasPeople?: boolean
    /** How many, for whoever may manage who signs in for a client. */
    people?: number
}

/** What the server says it did. */
type Done = { archived?: boolean; forTax?: boolean; forPeople?: boolean } | null | undefined

/**
 * Delete archives it instead, kept with what holds it: its tasks or
 * records, its tax position, or its people who can sign in, whose accounts
 * would go with it in one step (the owner, 2026-11-19).
 */
export const archivesInstead = (c: Deletable): boolean => !!(c.inUse || c.hasTax || c.hasPeople)

/** What's asked first: why it's archived, tasks or records before a tax position, a tax position before people. */
export function deleteQuestionKey(c: Deletable): TranslationKey {
    if (c.inUse) return 'clients_archive_question'
    if (c.hasTax) return 'clients_archive_question_tax'
    if (c.hasPeople) return 'clients_archive_question_people'
    return 'clients_delete_question'
}

/**
 * What's said once it's done. Archived as asked, it says only that; asked to
 * be deleted and archived all the same, as something came to hold it
 * meanwhile, it says what.
 */
export function deletedToastKey(c: Deletable, done: Done): TranslationKey {
    if (!done?.archived) return 'clients_deleted_done'
    if (archivesInstead(c)) return 'clients_archived_asked'
    if (done.forTax) return 'clients_archived_done_tax'
    if (done.forPeople) return 'clients_archived_done_people'
    return 'clients_archived_done'
}

/**
 * Delete permanently's question, from the archive: what goes with it is said
 * before it goes. Its tax position, with how many claims are open for
 * whoever may see those; its people who can sign in, with how many for
 * whoever may manage them. Counts are in the page's digits, and a name is
 * written as it's given.
 */
export function deleteForGoodQuestion(c: Deletable, t: (key: TranslationKey) => string, locale: string): string {
    const n = (count: number) => count.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const parts = [t('clients_delete_for_good_ask').replace('{name}', () => c.name)]
    if (c.hasTax) parts.push(c.taxClaims === undefined ? t('clients_delete_for_good_tax') : t('clients_delete_for_good_tax_claims').replace('{count}', n(c.taxClaims)))
    if (c.hasPeople) parts.push(c.people === undefined ? t('clients_delete_for_good_people') : t('clients_delete_for_good_people_count').replace('{count}', n(c.people)))
    parts.push(t('clients_delete_for_good_end'))
    return parts.join(' ')
}
