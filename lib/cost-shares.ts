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
 * Whether nothing of a task's cost is left to pay: no share still owed. A
 * status for someone with no share, or a share of nothing, doesn't keep the
 * task waiting, since the Costs page shows neither (Codex on #87). A cost
 * not split by member is paid once every status recorded for it is.
 */
export function allSharesPaid(shares: Record<string, unknown>, statuses: Record<string, unknown>): boolean {
    const owed = Object.entries(shares)
    if (owed.length === 0) return Object.values(statuses).every(status => status === "PAID")
    return owed.every(([userId, amount]) => !shareOwed(amount, statuses[userId]))
}
