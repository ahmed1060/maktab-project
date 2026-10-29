/**
 * A task's costs (CLIENTS_PLAN.md §4.4, §4.5). Each is a row of its own
 * (TaskCost), with its id and description, and an entry in the task's
 * comments naming that row, which the release before reads and writes.
 *
 * While the release before may be live, the entries say which costs a task
 * has: it adds entries with no row, and removes an entry and leaves its row.
 * A later migration gives those entries their rows and removes the rows left
 * over; until then, a cost with no row is removed by when it was added.
 */

export const COST_DESCRIPTION_MAX = 200

/** A cost entry in a task's comments, as the app writes it. */
export type CostEntry = {
    type: 'COST_ADDITION'
    text: string
    amount: number
    /** Its row. */
    costId?: string
    description?: string
    author?: string | null
    authorId?: string | null
    date: string
}

/** One cost, as the task's page lists it. */
export type CostLine = {
    /** Its row; none for one the release before added. */
    id: string | null
    /** When it was added, which costs added together share. */
    date: string
    amount: number
    description: string | null
    author: string | null
    authorId: string | null
}

export function isCostEntry(entry: unknown): entry is CostEntry {
    return !!entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'COST_ADDITION'
}

/**
 * An amount to the cent: what a cost's row keeps. Half a cent goes up, by the
 * amount's decimal digits, as Postgres's round() takes them: 1.005 is a hair
 * under in binary, so times 100 it rounded down. Too small or too large to be
 * written without an exponent, it has no half cent to lose.
 */
export function cents(amount: number): number {
    if (/e/i.test(String(amount))) return Math.round(amount * 100) / 100
    const sign = amount < 0 ? -1 : 1
    return sign * Number(`${Math.round(Number(`${Math.abs(amount)}e2`))}e-2`)
}

/**
 * A cost entry for an amount above nothing, to the cent: the app never wrote
 * any other, and the migration gave only these rows.
 */
function isCost(entry: unknown): entry is CostEntry {
    return isCostEntry(entry) && typeof entry.amount === 'number' && cents(entry.amount) > 0
}

/**
 * What was typed as a cost's description, or none. Refused over 200
 * characters: it used to be thrown away, whatever its length (§1).
 */
export function readDescription(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const text = raw.trim()
    if (!text) return null
    if (text.length > COST_DESCRIPTION_MAX) throw new Error('COST_DESCRIPTION_TOO_LONG')
    return text
}

/** A cost's entry, naming its row, with its description for the release before to show. */
export function costEntry(cost: { id: string; amount: number; description: string | null; author: string | null; authorId: string; date: string }): CostEntry {
    return {
        type: 'COST_ADDITION',
        text: `Added cost: ${cost.amount.toFixed(2)} EGP`,
        amount: cost.amount,
        costId: cost.id,
        ...(cost.description ? { description: cost.description } : {}),
        author: cost.author,
        authorId: cost.authorId,
        date: cost.date,
    }
}

/**
 * The task's costs, in the order they were added: each entry, with its
 * row's id and description. A row whose entry the release before removed
 * isn't one any more.
 */
export function costLines(comments: unknown, rows: { id: string; description: string | null }[]): CostLine[] {
    const byId = new Map(rows.map(r => [r.id, r]))
    const entries = Array.isArray(comments) ? comments : []
    return entries.filter(isCost).map(e => {
        const row = typeof e.costId === 'string' ? byId.get(e.costId) : undefined
        return {
            id: row?.id ?? null,
            date: String(e.date),
            amount: e.amount,
            description: row ? row.description : typeof e.description === 'string' && e.description.trim() ? e.description : null,
            author: typeof e.author === 'string' ? e.author : null,
            authorId: typeof e.authorId === 'string' ? e.authorId : null,
        }
    })
}
