import type { EntryKind } from '@/lib/cash-advances'

/** A person on the Cash advances tab (CLIENTS_PLAN.md §7.5). */
export type AdvanceHolder = {
    id: string
    name: string
    /** Not suspended, deleted or gone: an advance may be given. */
    atWork: boolean
    balance: number
    /** What of the balance is for a task or a client (CLIENTS_PLAN.md §7.9). */
    earmarked: number
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
    /** A Spent one's task, while it's there (§7.4). */
    task: { id: string; title: string } | null
    /** What the money is for, while it's there (§7.9). */
    forTask: { id: string; title: string } | null
    forClient: { id: string; name: string } | null
    /** Taken from a task or a client since deleted: a Moved one (§7.9). */
    partGone: boolean
    /** Passed on with a transfer: who it went to, or came from (§7.9, 7h). */
    counterpartName: string | null
}

/** What a person holds for one task or one client (§7.9). */
export type HeldFor = { forTask: { id: string; title: string } | null; forClient: { id: string; name: string } | null; amount: number }

/** What the company owes someone for their costs, as Mark all as paid would pay it (§7.3). */
export type Owed = { count: number; amount: number; digest: string }

/** Whose advance a dialog records on, and what they hold. */
export type AdvancePerson = { id: string; name: string; balance: number }
