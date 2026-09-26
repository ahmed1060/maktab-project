import type { Permission, Scope } from "./catalogue"

/**
 * What each of today's built-in roles may do, as permissions.
 *
 * This is Part A's bridge (ROLES_PLAN.md §7): can() answers from this table, so
 * moving a check from `role === 'ADMIN'` to `can(actor, 'payroll.approve')`
 * changes nothing anybody can do. In Part B the same grants become rows, and
 * this table is what the migration seeds them from.
 *
 * **A module appears here only once it has migrated.** An entry is a claim
 * about what the code allowed, and a claim written from reading the code can be
 * a misreading. So each module is added together with characterization tests
 * that drive its real routes as every role, recorded against the code before
 * the migration and passing unchanged after it. A permission missing from a
 * role's entry is refused — which is correct for a module whose checks still
 * read the role directly and never ask can() at all.
 *
 * SUPER_ADMIN is not here. The Super Admin is outside the role system and holds
 * every permission everywhere (can() answers that before reading this table).
 *
 * Migrated so far:
 * - Payroll — lib/permissions/payroll-access.characterization.test.ts
 * - Day off — lib/permissions/dayoff-access.characterization.test.ts
 *   (not yet dayoff.adjust_credit: changing a balance goes through
 *   PUT /api/users, and moves with the Employees module)
 */

export type BuiltInRole = "ADMIN" | "TEAM_LEADER" | "EMPLOYEE"

export type Grants = Partial<Record<Permission, Scope>>

export const BUILT_IN_GRANTS: Record<BuiltInRole, Grants> = {
    ADMIN: {
        // Payroll: an Admin manages their own company's payroll month and the
        // documents it produces. PAYROLL_MANAGERS in lib/payroll-scope.ts.
        "payroll.view": "COMPANY",
        "payroll.prepare": "COMPANY",
        "payroll.approve": "COMPANY",
        "payroll.issue_payslips": "COMPANY",
        "payroll.mark_paid": "COMPANY",
        "settlements.manage": "COMPANY",
        "debts.view": "COMPANY",
        "debts.waive": "COMPANY",
        // Implied by payroll.view. An Admin already sees every salary in their
        // company — the canViewSalary rule in app/api/users/route.ts.
        "salary.view": "COMPANY",

        // Day off: an Admin sees their company's requests and decides them.
        "dayoff.view": "COMPANY",
        "dayoff.approve": "COMPANY",
    },
    // Neither holds any payroll or day-off permission. A person's own
    // payslips, leave requests and leave history reach them through owner
    // rules on those routes, which are not permissions. A Team Leader does not
    // see or decide their team's leave today.
    TEAM_LEADER: {},
    EMPLOYEE: {},
}

export function isBuiltInRole(role: string | null | undefined): role is BuiltInRole {
    return role === "ADMIN" || role === "TEAM_LEADER" || role === "EMPLOYEE"
}

/**
 * The built-in roles that hold a permission — for "who should be told", which
 * is a query over people rather than a check on one. Until roles are data this
 * is how a notification finds the people who can act on it, instead of naming
 * a role. Super Admins are not included; callers add them as they always have.
 */
export function builtInRolesHolding(permission: Permission): BuiltInRole[] {
    return (Object.keys(BUILT_IN_GRANTS) as BuiltInRole[])
        .filter(role => BUILT_IN_GRANTS[role][permission] !== undefined)
}
