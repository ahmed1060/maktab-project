import { shareOwed, unallocatedCost } from "@/lib/cost-shares"

/**
 * What the Costs page's list comes to (CLIENTS_PLAN.md §3.5): every page of
 * it, not the one shown, and only what's still due, as the page's cards show
 * it (lib/cost-shares.ts): each member's share still owed, and the part of a
 * task's cost that's no one's share, a cost with no split all of it. With an
 * employee picked, it's their shares still owed.
 */
export function costsDue(
    tasks: { totalCost: number | string; memberCosts: unknown; memberPaymentStatus: unknown }[],
    employeeId?: string | null,
): number {
    let due = 0
    for (const task of tasks) {
        const shares = asRecord(task.memberCosts)
        const paid = asRecord(task.memberPaymentStatus)
        for (const [userId, amount] of Object.entries(shares)) {
            if (employeeId && userId !== employeeId) continue
            if (shareOwed(amount, paid[userId])) due += Number(amount)
        }
        if (!employeeId) due += unallocatedCost(task.totalCost, shares)
    }
    // To the piastre, without a float's tail.
    return Math.round(due * 100) / 100
}

function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value === "string") {
        try { return asRecord(JSON.parse(value)) } catch { return {} }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
