/**
 * Whether a member's share of a task's cost is still to pay: more than
 * nothing, and not marked paid. A share with no status is unpaid.
 *
 * The Costs page shows these and only these, Mark all as paid pays them, and
 * a task is paid once none is left (CLIENTS_PLAN.md §1). `unpaidShareOf` in
 * lib/services/costs-query.ts asks Postgres the same. No imports: the Costs
 * page reads it.
 */
export function shareOwed(amount: unknown, status: unknown): boolean {
    return Number(amount) > 0 && status !== "PAID"
}

/**
 * What of a task's cost is no one's share: its total less every share, as a
 * task's whole cost was before shares. A task that had a cost then and a
 * share added since has both (Codex on #87). The task's own, not anyone's,
 * it's paid with the task. Counted in whole piastres, so shares of 0.1 and
 * 0.2 don't leave a remainder of a fraction.
 */
export function unallocatedCost(total: unknown, shares: Record<string, unknown>): number {
    const piastres = (amount: unknown) => Math.round(Number(amount) * 100) || 0
    const split = Object.values(shares).reduce((sum: number, amount) => sum + Math.max(piastres(amount), 0), 0)
    return Math.max(piastres(total) - split, 0) / 100
}

/**
 * Whether nothing of a task's cost is left to pay: no share still owed, and
 * none of it no one's share. A status for someone with no share, or a share
 * of nothing, doesn't keep the task waiting, since the Costs page shows
 * neither (Codex on #87). A cost not split by member is paid once every
 * status recorded for it is.
 */
export function allSharesPaid(shares: Record<string, unknown>, statuses: Record<string, unknown>, total: unknown): boolean {
    const owed = Object.entries(shares)
    if (owed.length === 0) return Object.values(statuses).every(status => status === "PAID")
    if (unallocatedCost(total, shares) > 0) return false
    return owed.every(([userId, amount]) => !shareOwed(amount, statuses[userId]))
}
