/**
 * Live updates, part 5 (REALTIME_PLAN.md; DESIGN.md §8): what someone else
 * changed is shown for a moment, so nobody has to hunt for it.
 *
 * A list compares how it was drawn before a live signal with how it's drawn
 * after: the rows that are new, or hold something new, take the brand tint
 * for ARRIVAL_MS (components/useArrivals.ts, components/ui/ui.css). A row
 * that went is simply gone. The bell's count grows a little as it rises.
 */

/** How long a row that arrived or changed is marked: its tint holds, then fades, within it. */
export const ARRIVAL_MS = 2000

/**
 * How long a draw is waited for after a live signal, or after the person's
 * own action, before it's forgotten: a draw that changed nothing mustn't
 * claim a change that comes later.
 */
export const EXPECT_MS = 10_000

/**
 * A list as drawn: where it is (the page and its address, with its tab,
 * filters and page) and what each row holds, by its key. A string, so two
 * draws compare by value.
 */
export function drawn<T>(scope: string, rows: readonly T[], rowKey: (row: T) => string): string {
    return JSON.stringify([scope, rows.map(row => [rowKey(row), JSON.stringify(row)])])
}

/**
 * The keys of the rows that arrived, or hold something new, between two
 * draws of the same list. None between two different lists: a tab, a
 * filter or a page changed, and every row is new only because the person
 * asked for others.
 */
export function arrivedBetween(before: string, after: string): string[] {
    const [scopeBefore, rowsBefore] = JSON.parse(before) as [string, [string, string][]]
    const [scopeAfter, rowsAfter] = JSON.parse(after) as [string, [string, string][]]
    if (scopeBefore !== scopeAfter) return []
    const was = new Map(rowsBefore)
    return rowsAfter.filter(([key, row]) => was.get(key) !== row).map(([key]) => key)
}

/**
 * What the next draw of a list follows: someone else's change, as a live
 * signal says, or the person's own, as their page draws itself again after
 * it. Null once a draw has come, or after EXPECT_MS.
 */
export type Expecting = { from: 'live' | 'own' } | null

/**
 * What the next draw follows once a signal or the person's own action
 * comes. Their own wins over a signal while it waits: their own change
 * sends one too, and theirs is never shown. A new one each time, so its
 * wait starts again.
 */
export function expectNext(was: Expecting, from: 'live' | 'own'): NonNullable<Expecting> {
    return { from: was?.from === 'own' ? 'own' : from }
}

/**
 * The keys to mark as a list is drawn again: the rows that arrived, or
 * hold something new, if the draw follows someone else's change, and none
 * otherwise (a filter, a tab, a page, the person's own change, or a draw
 * nothing announced).
 */
export function arrivedOnDraw(expecting: Expecting, before: string, now: string): string[] {
    return expecting?.from === 'live' ? arrivedBetween(before, now) : []
}

/**
 * The rows marked as arrived, each with the draw that marked it last
 * (counted from 1), so that each draw's rows are unmarked 2 seconds after
 * it, whatever draws come after (found by Codex on PR 251).
 */
export type Marks = ReadonlyMap<string, number>

/** Marks `keys` as arrived in draw `n`. A row marked before, that changed again, is now this draw's. */
export function mark(was: Marks, keys: readonly string[], n: number): Marks {
    const next = new Map(was)
    for (const key of keys) next.set(key, n)
    return next
}

/** Unmarks the rows draw `n` marked, leaving those a later draw marked again. */
export function unmark(was: Marks, n: number): Marks {
    const next = new Map([...was].filter(([, by]) => by !== n))
    return next.size === was.size ? was : next
}

/**
 * Whether a count rose from one answer to the next. Not from the count the
 * server drew the page with to the first answer (`before` is null then): a
 * page opening grows nothing.
 */
export function rose(before: number | null, after: number): boolean {
    return before !== null && after > before
}
