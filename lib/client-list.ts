import { missingLanguages, nameIn } from '@/lib/names'
import type { Locale } from '@/lib/translations'

/**
 * Clients' names on the Clients page (LATER_CHANGES_PLAN.md §3.1, step 6b,
 * PR 407; DESIGN.md §5.3): each in the page's language, searched in either,
 * an Arabic page's in Arabic order, and the ones still missing a language.
 * Read from the list the page already has, as its search is, so no new
 * query asks the server for them.
 */

/** A client's names as GET /api/clients gives them: each in English, and in Arabic once it has one (PR 398). */
export type ClientNames = { name: string; nameAr?: string | null; ownerName: string; ownerNameAr?: string | null }

/** A client's own name, in English and in Arabic once it has one, as its pickers have it (PR 412). */
export type ClientName = Pick<ClientNames, 'name' | 'nameAr'>

/** Its name in the page's language, or the one it has. */
export function clientName(c: ClientName, locale: Locale): string {
    return nameIn(locale, { en: c.name, ar: c.nameAr })
}

/** Its owner's name in the page's language, or the one it has. */
export function ownerName(c: ClientNames, locale: Locale): string {
    return nameIn(locale, { en: c.ownerName, ar: c.ownerNameAr })
}

/** Found by its name or its owner's, in either language; `search` is lower-cased already. */
export function clientMatches(c: ClientNames, search: string): boolean {
    return [c.name, c.nameAr, c.ownerName, c.ownerNameAr].some(name => !!name && name.toLowerCase().includes(search))
}

/**
 * The clients in the page's order. On an Arabic page, the ones with an
 * Arabic name first, alphabetically in Arabic, then the rest as the server
 * gave them, by their English. An English page keeps the server's order.
 */
export function clientsInOrder<C extends ClientName>(clients: readonly C[], locale: Locale): C[] {
    if (locale !== 'ar') return [...clients]
    const inArabic = clients.filter(c => c.nameAr?.trim())
    const rest = clients.filter(c => !c.nameAr?.trim())
    return [...inArabic.sort((a, b) => a.nameAr!.trim().localeCompare(b.nameAr!.trim(), 'ar')), ...rest]
}

/** Which languages its names are missing: no Arabic, or an English holding Arabic letters or nothing. */
export function clientMissing(c: ClientNames): ('en' | 'ar')[] {
    return missingLanguages([{ en: c.name, ar: c.nameAr }, { en: c.ownerName, ar: c.ownerNameAr }])
}

/** How many clients have a name in one language only. */
export function missingCount(clients: readonly ClientNames[]): number {
    return clients.filter(c => clientMissing(c).length > 0).length
}

/** A client a form picked, with the company chosen when it was. */
export type ClientPick = { id: string; company: string | null }

/**
 * The client a form sends while `company` is the one chosen: the one picked
 * in it, and none in another. A Super Admin who picks a client and then
 * switches company sends no other company's client, which the server would
 * refuse, nor a hidden one (Codex review of PR 435), as a title picked from a
 * company's list isn't kept either (saved-lists.ts, pickIn).
 */
export function clientPickedIn(pick: ClientPick, company: string | null): string {
    return pick.company === company ? pick.id : ''
}
