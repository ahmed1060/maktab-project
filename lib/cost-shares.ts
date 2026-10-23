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
