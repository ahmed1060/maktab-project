/**
 * What happens to what's held for a task as it's transferred (CLIENTS_PLAN.md
 * §7.9, step 7h). One answer for both Transfer task's dialog, saying it
 * before it's sent, and the transfer, doing it.
 *
 * Only a transfer that adds someone makes a copy, and only a copy moves
 * anything. Whoever's on the copy keeps what they held, now for the copy.
 * Whoever's left off passes theirs to one person on the copy, picked, or the
 * copy's only person, if whoever transfers it may give and settle both
 * their advances and the receiver may take one (at work, in the task's
 * company); otherwise it joins their own running balance.
 */

/** Someone on the task, and what they hold for it. */
export type HeldOnTask = { userId: string; amount: number }

export type TransferMove =
    | { userId: string; amount: number; what: "KEPT" }
    /** To the receiver; null while nobody's picked. */
    | { userId: string; amount: number; what: "PASSED"; to: string | null }
    | { userId: string; amount: number; what: "RUNNING" }

export function transferPlan({ current, next, held, picked, mayPass, mayReceive = () => true }: {
    /** Who's on the task now, and who the transfer puts on the copy. */
    current: readonly string[]
    next: readonly string[]
    held: readonly HeldOnTask[]
    /** Who takes what the left-off hold, as picked; one of `next`, or null. */
    picked: string | null
    /** Whether whoever transfers it may give and settle this person's advance. */
    mayPass: (userId: string) => boolean
    /** Whether the receiver may be given money: at work, in the task's company (Codex on PR 241). */
    mayReceive?: (userId: string) => boolean
}): { copy: boolean; moves: TransferMove[]; needsReceiver: boolean } {
    const copy = next.some(id => !current.includes(id))
    if (!copy) return { copy, moves: [], needsReceiver: false }
    const receiver = picked ?? (next.length === 1 ? next[0] : null)
    const moves: TransferMove[] = []
    let needsReceiver = false
    const holders = held.filter(h => h.amount > 0 && current.includes(h.userId)).sort((a, b) => a.userId.localeCompare(b.userId))
    for (const { userId, amount } of holders) {
        if (next.includes(userId)) moves.push({ userId, amount, what: "KEPT" })
        else if (!mayPass(userId) || (receiver !== null && !(mayPass(receiver) && mayReceive(receiver)))) moves.push({ userId, amount, what: "RUNNING" })
        else {
            if (receiver === null) needsReceiver = true
            moves.push({ userId, amount, what: "PASSED", to: receiver })
        }
    }
    return { copy, moves, needsReceiver }
}
