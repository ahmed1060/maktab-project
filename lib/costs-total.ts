import { shareOwed, unallocatedCost } from "@/lib/cost-shares"
import type { TranslationKey } from "@/lib/translations"

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

/** A task's shares or their payments, as stored: an object, or JSON text of one, as older tasks have. */
export function asRecord(value: unknown): Record<string, unknown> {
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
 * With a cost name picked (§5.9), what's due of the costs of that name, in
 * parts as dueParts has them: each member's costs of that name on a task,
 * while their share is still owed, and those that are no one's share, the
 * task's own part. With an employee picked, their costs of that name only.
 * Each task's `costs` are those of the name (lib/saved-lists.ts costNamed).
 */
export function namedParts(
    tasks: { id: string; memberCosts: unknown; memberPaymentStatus: unknown; costs: { authorId: string | null; amount: number | string | { toString(): string } }[] }[],
    employeeId?: string | null,
): DuePart[] {
    const parts = new Map<string, DuePart>()
    for (const task of tasks) {
        const shares = asRecord(task.memberCosts)
        const paid = asRecord(task.memberPaymentStatus)
        for (const cost of task.costs) {
            const member = cost.authorId && cost.authorId in shares ? cost.authorId : null
            if ((employeeId && member !== employeeId) || (member && !shareOwed(shares[member], paid[member]))) continue
            const key = `${task.id}:${member ?? "-"}`
            const part = parts.get(key) ?? { taskId: task.id, userId: member, amount: 0 }
            part.amount += Number(cost.amount)
            parts.set(key, part)
        }
    }
    // To the piastre, each part and so their sum.
    return [...parts.values()].map(p => ({ ...p, amount: Math.round(p.amount * 100) / 100 })).filter(p => p.amount > 0)
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

/**
 * What Mark all as paid's window asks and its button says (§4.1): "Pay 7
 * costs, 3,450.00 EGP", and "Pay 1 cost" for one, in the reader's numerals.
 */
export function payWording(t: (key: TranslationKey) => string, locale: string, count: number, amount: number) {
    const number = (n: number, digits?: number) => n.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", digits === undefined ? undefined : { minimumFractionDigits: digits, maximumFractionDigits: digits })
    const say = (key: TranslationKey) => t(key).replace("{count}", number(count)).replace("{amount}", number(amount, 2))
    return count === 1
        ? { question: say("costs_pay_question_one"), button: say("costs_pay_button_one") }
        : { question: say("costs_pay_question"), button: say("costs_pay_button") }
}
