import type { Minor } from "./payroll"

/**
 * Taking back what somebody owes, out of what they are about to be paid.
 *
 * A debt is raised when a month's deductions exceed its earnings: the payslip
 * floors at zero, because you cannot take money out of a bank account through
 * payroll, and the remainder is carried. Until now that was the end of it — the
 * debt was recorded, listed, and never collected by anything, so it was
 * forgiven by inaction.
 *
 * This is the collection. It runs against the net, after everything else, and
 * it is the one deduction that can never create a debt of its own: it is capped
 * at what is there, so the net after recovery is never below zero and nothing
 * is carried from it. A recovery that could carry would be a machine for
 * turning one debt into two.
 *
 * The cap exists because the obvious version of this is dangerous. Chained
 * across months it can take somebody's pay to zero twice running with nobody
 * deciding it should, which is why most jurisdictions limit how much of a wage
 * can be taken at once. It defaults to the whole net — today's agreed
 * behaviour — and the point of having it at all is that changing that later is
 * a number in a settings form rather than a change to how payroll works.
 */

export const FULL_RECOVERY_PERCENT = 100

/** A debt as the planner needs it: what is still owed, and when it came due. */
export interface RecoverableDebt {
    id: string
    /** amount minus whatever has already been taken. Never negative. */
    outstandingMinor: Minor
    dueDate: Date
}

export interface RecoveryAllocation {
    debtId: string
    amountMinor: Minor
}

export interface RecoveryPlan {
    totalMinor: Minor
    allocations: RecoveryAllocation[]
    /** What the cap allowed, before any debt was matched against it. */
    availableMinor: Minor
}

/**
 * The most that may be taken from one month's net.
 *
 * Rounded down, so a cap is never exceeded by a rounding step — a percentage
 * that rounds up is not a cap, it is a suggestion. 100 returns the net exactly,
 * which is what makes the default a no-op rather than a special case.
 */
export function recoverableFrom(netMinor: Minor, capPercent: number): Minor {
    if (netMinor <= 0) return 0
    const clamped = Math.max(0, Math.min(100, capPercent))
    return Math.floor((netMinor * clamped) / 100)
}

/**
 * Which debts to take, and how much of each.
 *
 * Oldest due first, so the queue drains in the order it formed and a debt
 * cannot be overtaken indefinitely by newer ones. Ties break on id, because a
 * plan that depends on which row the database happened to return first is a
 * plan that changes between a draft and its approval.
 *
 * A debt that is not due yet is not touched. Somebody who owes money due in
 * May has not defaulted in April, and taking it early is the company deciding
 * its own terms are earlier than it said.
 */
export function planRecovery(input: {
    netMinor: Minor
    debts: RecoverableDebt[]
    capPercent: number
    /** Debts due after this are left alone. */
    dueOnOrBefore: Date
}): RecoveryPlan {
    const availableMinor = recoverableFrom(input.netMinor, input.capPercent)
    if (availableMinor <= 0) return { totalMinor: 0, allocations: [], availableMinor }

    const due = input.debts
        .filter(d => d.outstandingMinor > 0 && d.dueDate.getTime() <= input.dueOnOrBefore.getTime())
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id))

    let remaining = availableMinor
    const allocations: RecoveryAllocation[] = []

    for (const debt of due) {
        if (remaining <= 0) break
        const take = Math.min(debt.outstandingMinor, remaining)
        allocations.push({ debtId: debt.id, amountMinor: take })
        remaining -= take
    }

    return {
        totalMinor: allocations.reduce((sum, a) => sum + a.amountMinor, 0),
        allocations,
        availableMinor,
    }
}

/** How a recovery line is labelled and traced back to the debt it paid down. */
export const DEBT_RECOVERY_SOURCE = "DEBT_RECOVERY"

export function recoveryLabel(partial: boolean): string {
    // Said on the payslip, because somebody whose pay dropped needs to know
    // why, and "part of" is the difference between "this is finished" and
    // "expect this again next month".
    return partial ? "Debt repayment (part)" : "Debt repayment"
}

/**
 * The last chance to collect: recovery out of a final settlement.
 *
 * Two rules differ from the monthly kind, and both follow from there being no
 * next month.
 *
 * The percentage cap does not apply. It exists so somebody still earning is not
 * left with nothing to live on, and at a settlement there is no future income
 * to protect — leaving a debt uncollected because of a rule written to guard
 * next month's wages is the rule misfiring on the one occasion it cannot help.
 *
 * And nothing is filtered by due date. A debt due next month cannot be
 * collected next month, because the person will not be there; at a settlement
 * every outstanding debt has effectively come due.
 *
 * What does not change is the ceiling: the settlement itself. A leaver is never
 * billed on their way out, so what this cannot reach survives as a debt rather
 * than being turned into a demand.
 */
export function planFinalRecovery(input: { netMinor: Minor; debts: RecoverableDebt[] }): RecoveryPlan {
    return planRecovery({
        netMinor: input.netMinor,
        debts: input.debts,
        capPercent: FULL_RECOVERY_PERCENT,
        // Far enough ahead that every outstanding debt is included; the filter
        // is meaningless here and this says so rather than duplicating the
        // allocation loop to remove it.
        dueOnOrBefore: new Date(8640000000000000),
    })
}
