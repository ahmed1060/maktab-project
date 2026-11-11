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
 * signal says, or the person's own, saved, as their page draws itself
 * again after it, or neither yet (null) while an action of theirs is on its
 * way; and how many of their actions are. Null once a draw has come and
 * none is, or EXPECT_MS after.
 */
export type Expecting = { from: 'live' | 'own' | null; acting: number } | null

/**
 * What the next draw follows once a signal comes, or the person's page says
 * their change is saved. Their own wins over a signal while it waits: their
 * own change sends one too, and theirs is never shown. A new one each time,
 * so its wait starts again.
 */
export function expectNext(was: Expecting, from: 'live' | 'own'): NonNullable<Expecting> {
    return { from: was?.from === 'own' ? 'own' : from, acting: was?.acting ?? 0 }
}

/**
 * The person's own action starting, before it sends anything: what's drawn
 * is theirs while it's on its way, however long that is. A two-factor code
 * asked for on the way holds it for as long as the code takes to type, and
 * their change, and its signal, come only after (PR 252). It says nothing
 * yet of the draw after its answer: only its page knows whether it's saved.
 */
export function actionStarts(was: Expecting): NonNullable<Expecting> {
    return { from: was?.from ?? null, acting: (was?.acting ?? 0) + 1 }
}

/**
 * The person's own action answered. Saved, their page has said so first
 * (expectNext 'own'), and the draw that follows is theirs. Refused, it
 * saved nothing, and the draw that follows is what a signal says, if one
 * came: someone else's change isn't hidden because theirs was refused
 * (found by Codex on PR 251). Once none is on its way, what's left is
 * waited for EXPECT_MS.
 */
export function actionAnswered(was: Expecting): Expecting {
    if (was === null) return null
    const acting = Math.max(0, was.acting - 1)
    return was.from === null && acting === 0 ? null : { from: was.from, acting }
}

/**
 * What a draw leaves waiting: nothing, unless an action of the person's own
 * is still on its way, whose change can come in a later draw; and, if
 * their change is saved, that the next draw is theirs. A signal is spent
 * on the draw it brought.
 */
export function afterDraw(was: Expecting): Expecting {
    return was !== null && was.acting > 0 ? { from: was.from === 'own' ? 'own' : null, acting: was.acting } : null
}

/** Whether what's waited for is forgotten after EXPECT_MS: not while an action is on its way. */
export function forgets(was: Expecting): boolean {
    return was !== null && was.acting === 0
}

/**
 * The keys to mark as a list is drawn again: the rows that arrived, or
 * hold something new, if the draw follows someone else's change, and none
 * otherwise (a filter, a tab, a page, the person's own change, a draw
 * while an action of theirs is on its way, or a draw nothing announced).
 */
export function arrivedOnDraw(expecting: Expecting, before: string, now: string): string[] {
    return expecting?.from === 'live' && expecting.acting === 0 ? arrivedBetween(before, now) : []
}

/**
 * A row's mark: the draw that marked it last (counted from 1), so that each
 * draw's rows are unmarked 2 seconds after it, whatever draws come after
 * (found by Codex on PR 251); and whether that draw marked it again while
 * it was marked, flipping each time, so its tint starts again (arrivedAs).
 */
export type Mark = { readonly by: number; readonly again: boolean }

/** The rows marked as arrived, by key. */
export type Marks = ReadonlyMap<string, Mark>

/** Marks `keys` as arrived in draw `n`. A row marked before, that changed again, is now this draw's. */
export function mark(was: Marks, keys: readonly string[], n: number): Marks {
    const next = new Map(was)
    for (const key of keys) {
        const marked = was.get(key)
        next.set(key, { by: n, again: marked ? !marked.again : false })
    }
    return next
}

/** Unmarks the rows draw `n` marked, leaving those a later draw marked again. */
export function unmark(was: Marks, n: number): Marks {
    const next = new Map([...was].filter(([, marked]) => marked.by !== n))
    return next.size === was.size ? was : next
}

/**
 * A row's `data-arrived` (components/ui/DataList.tsx): which of the two
 * tints it takes, or none. They're one tint under two names
 * (components/ui/ui.css). A row marked again while marked takes the other
 * name, so its tint starts again: under the same name, its animation would
 * carry on where it was, and a change 1.5 seconds after the last would show
 * only the end of its fade (found by Codex on PR 251).
 */
export function arrivedAs(marks: { get: (key: string) => Mark | undefined } | undefined, key: string): 'once' | 'again' | undefined {
    const marked = marks?.get(key)
    return marked ? (marked.again ? 'again' : 'once') : undefined
}

/**
 * Whether a count rose from one answer to the next. Not from the count the
 * server drew the page with to the first answer (`before` is null then): a
 * page opening grows nothing.
 */
export function rose(before: number | null, after: number): boolean {
    return before !== null && after > before
}
