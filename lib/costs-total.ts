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

/** One part of a cost still due: a member's share, or the task's own part, no one's share (userId null). */
export type DuePart = { taskId: string; userId: string | null; amount: number }

/**
 * Every part still due in a list (§4.1), what "Mark all as paid" pays: each
 * member's share still owed, and the part of a task's cost that's no one's
 * share, by the rules of lib/cost-shares.ts. With an employee picked, their
 * shares only, as the Costs page lists and pays then.
 */
export function dueParts(tasks: { id: string; totalCost: number | string; memberCosts: unknown; memberPaymentStatus: unknown }[], employeeId?: string | null): DuePart[] {
    const parts: DuePart[] = []
    for (const task of tasks) {
        const shares = asRecord(task.memberCosts)
        const paid = asRecord(task.memberPaymentStatus)
        for (const [userId, amount] of Object.entries(shares)) {
            if (employeeId && userId !== employeeId) continue
            if (shareOwed(amount, paid[userId])) parts.push({ taskId: task.id, userId, amount: Number(amount) })
        }
        if (employeeId) continue
        const own = unallocatedCost(task.totalCost, shares)
        if (own > 0) parts.push({ taskId: task.id, userId: null, amount: own })
    }
    return parts
}

/**
 * The parts as one line of text, the same whatever order they came in: what
 * a confirmation is checked against, so a part added, removed or changed
 * since shows (§4.1).
 */
export function partsLine(parts: DuePart[]): string {
    return parts
        .map(p => `${p.taskId}:${p.userId ?? "-"}:${p.amount.toFixed(2)}`)
        .sort()
        .join("|")
}
