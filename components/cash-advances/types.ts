import type { EntryKind } from '@/lib/cash-advances'

/** A person on the Cash advances tab (CLIENTS_PLAN.md §7.5). */
export type AdvanceHolder = {
    id: string
    name: string
    /** Not suspended, deleted or gone: an advance may be given. */
    atWork: boolean
    balance: number
    awaiting: number
    lastDate: string | null
}

/** One movement of a person's advance (§7.4). */
export type AdvanceEntry = {
    id: string
    kind: EntryKind
    /** Signed, as the balance takes it. */
    amount: number
    date: string
    note: string | null
    photoUrl: string | null
    confirmedAt: string | null
    recordedByName: string | null
    createdAt: string
}

/** Whose advance a dialog records on, and what they hold. */
export type AdvancePerson = { id: string; name: string; balance: number }
