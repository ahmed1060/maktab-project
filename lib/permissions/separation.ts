import type { Permission } from "./catalogue"
import type { Grants } from "./grants"

/**
 * Separation of duties (ROLES_PLAN.md §6.11): pairs of permissions that are
 * each legitimate but risky in one person's hands — together they let
 * somebody both make a payment happen and sign it off. A role may still hold
 * both; the Super Admin is warned and the decision recorded. Clients with an
 * auditor ask about exactly these.
 */
export const SEPARATION_OF_DUTIES: readonly { pair: readonly [Permission, Permission]; key: string }[] = [
    // Whoever prepares the month's payroll should not also approve it.
    { pair: ["payroll.prepare", "payroll.approve"], key: "prepare_approve_payroll" },
    // Changing what somebody earns and approving what is paid.
    { pair: ["salary.edit", "payroll.approve"], key: "salary_approve_payroll" },
    // Creating a person and setting their pay: a paid person nobody else saw.
    { pair: ["employees.create", "salary.edit"], key: "create_employee_salary" },
]

/** The pairs these grants hold both halves of. */
export function conflictsIn(grants: Grants): string[] {
    return SEPARATION_OF_DUTIES.filter(({ pair: [a, b] }) => !!grants[a] && !!grants[b]).map(c => c.key)
}

/** Pairs `after` holds that `before` did not — what a save newly introduces. */
export function newConflicts(before: Grants, after: Grants): string[] {
    const had = new Set(conflictsIn(before))
    return conflictsIn(after).filter(key => !had.has(key))
}
