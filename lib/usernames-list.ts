import { calendarDateStr } from '@/lib/time'

/**
 * Usernames (UI_PLAN.md §5 step 5): the people the viewer can see, searched
 * by name or username, and the Excel file of them.
 */
export type Person = { id: string; firstName: string; lastName: string; role: string; username?: string | null; status?: string }

export const nameOf = (p: Person) => `${p.firstName} ${p.lastName}`.trim()

/**
 * Still here: somebody who has left (archived) isn't listed or in the file,
 * as nothing can be given to them (decided 2026-11-03). Suspended is still on
 * staff; the deleted the server leaves out itself.
 */
export const current = (p: Person) => p.status !== 'ARCHIVED'

/** By name or username, case aside. */
export function matches(p: Person, query: string): boolean {
    const q = query.trim().toLocaleLowerCase()
    if (!q) return true
    return nameOf(p).toLocaleLowerCase().includes(q) || (p.username ?? '').toLocaleLowerCase().includes(q)
}

/** The file's rows: no username is an empty cell, where it was a dash somebody could copy. */
export function sheetRows(people: Person[], roleWord: (role: string) => string) {
    return people.map(p => ({ name: nameOf(p), role: roleWord(p.role), username: p.username ?? '' }))
}

/** "Usernames 2026-11-04.xlsx", for the day where it was downloaded, where it took the day in London. */
export function fileName(base: string, now: Date, timeZone: string): string {
    return `${base} ${calendarDateStr(now, timeZone)}.xlsx`
}
