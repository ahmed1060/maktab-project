/**
 * A task's costs (CLIENTS_PLAN.md §4.4, §4.5). Each is a row of its own
 * (TaskCost), which says the task has it, with its id and description. Each
 * is also an entry in the task's comments naming that row, still written for
 * the release before, which lists the entries; they agree since 4d's
 * migration.
 */

export const COST_DESCRIPTION_MAX = 200

/** The upload route's folder for costs' receipts (CLIENTS_PLAN.md §6.2). */
export const RECEIPTS_FOLDER = 'receipts'

/** What a receipt's picker offers: a photo, or a PDF, of what the upload route takes. */
export const RECEIPT_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf'

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

/** A cost's row, as the task's page has it. */
export type CostRow = {
    id: string
    amount: number
    description: string | null
    authorId: string | null
    authorName: string | null
    /** Its receipt's photo, if one was taken (§6.2). */
    receiptUrl: string | null
    /** When it was added, which costs added together share. */
    createdAt: string
}

/** One cost, as the task's page lists it. */
export type CostLine = {
    id: string
    date: string
    amount: number
    description: string | null
    author: string | null
    authorId: string | null
    receiptUrl: string | null
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

/**
 * A cost's receipt as sent, or none. Which file it is, and whose, is checked
 * where the cost is saved.
 */
export function readReceipt(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === '') return null
    if (typeof raw !== 'string') throw new Error('COST_RECEIPT_INVALID')
    return raw
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
 * The task's costs, in the order they were added: its rows, those added
 * together in the order their entries are in.
 */
export function costLines(rows: CostRow[], comments: unknown): CostLine[] {
    const entries = Array.isArray(comments) ? comments : []
    const place = new Map<string, number>()
    entries.forEach((e, i) => { if (isCostEntry(e) && typeof e.costId === 'string') place.set(e.costId, i) })
    const at = (id: string) => place.get(id) ?? Number.MAX_SAFE_INTEGER
    return [...rows]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || at(a.id) - at(b.id))
        .map(r => ({ id: r.id, date: r.createdAt, amount: r.amount, description: r.description, author: r.authorName, authorId: r.authorId, receiptUrl: r.receiptUrl ?? null }))
}
