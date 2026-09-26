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
    },
    // Neither holds any payroll permission. A person's own payslips reach them
    // through the owner rule on the payslip routes, which is not a permission.
    TEAM_LEADER: {},
    EMPLOYEE: {},
}

export function isBuiltInRole(role: string | null | undefined): role is BuiltInRole {
    return role === "ADMIN" || role === "TEAM_LEADER" || role === "EMPLOYEE"
}
