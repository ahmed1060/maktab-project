import { encodeGrants, type Grants } from "./grants"

export type { Grants }

/**
 * The grants the three built-in roles are created with.
 *
 * Part A's bridge (ROLES_PLAN.md §7): until roles were data, can() answered
 * from this table, and every access check moved onto it one module at a time,
 * each proved by characterization tests that drive the real routes as every
 * role. Now each company's Admin, Team Leader and Employee roles are rows, and
 * this is what they are seeded from — by the migration that created them, and
 * by CompanyService for every company created since. can() reads the person's
 * own grants, never this table.
 *
 * The records it was proved against:
 * - Payroll — lib/permissions/payroll-access.characterization.test.ts
 * - Day off — lib/permissions/dayoff-access.characterization.test.ts
 * - Salaries and adjustments — lib/permissions/salary-access.characterization.test.ts
 * - Employees — lib/permissions/employee-access.characterization.test.ts and
 *   lib/user-lookup-scope.test.ts
 * - Tasks — lib/permissions/task-access.characterization.test.ts
 * - Obligations — lib/permissions/obligation-access.characterization.test.ts
 * - Requests, name-change requests and performance points —
 *   lib/permissions/request-access.characterization.test.ts
 * - Clients, vendors and cost history —
 *   lib/permissions/client-access.characterization.test.ts
 * - Screens — lib/permissions/screen-gates.test.ts
 * - Protected fields — lib/permissions/field-access.characterization.test.ts
 *
 * SUPER_ADMIN is not here. The Super Admin is outside the role system and holds
 * every permission everywhere (can() answers that before reading any grants).
 */

export type BuiltInRole = "ADMIN" | "TEAM_LEADER" | "EMPLOYEE"


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

        // Adjustments: an Admin records, reverses and rolls back bonuses and
        // deductions for their company's people.
        "salary_adjustments.manage": "COMPANY",

        // Day off: an Admin sees their company's requests and decides them,
        // and sets people's balances and yearly allowances.
        "dayoff.view": "COMPANY",
        "dayoff.approve": "COMPANY",
        "dayoff.adjust_credit": "COMPANY",

        // Employees: an Admin manages their company's people. Making someone
        // an Admin, moving them between companies, the account status route
        // and permanent deletion stay the Super Admin's.
        "employees.view": "COMPANY",
        "employees.create": "COMPANY",
        "employees.edit": "COMPANY",
        "employees.change_status": "COMPANY",
        "employees.end_contract": "COMPANY",
        "employees.delete": "COMPANY",
        "employees.reset_password": "COMPANY",
        "employees.assign_team": "COMPANY",
        "employees.assign_role": "COMPANY",
        "salary.edit": "COMPANY",

        // Tasks: an Admin creates, edits, transfers, reviews, deletes, pays
        // and penalises their company's tasks. Reverting a reviewed task stays
        // the Super Admin's.
        "tasks.view": "COMPANY",
        "tasks.create": "COMPANY",
        "tasks.edit": "COMPANY",
        "tasks.transfer": "COMPANY",
        "tasks.review": "COMPANY",
        "tasks.delete": "COMPANY",
        "tasks.pay": "COMPANY",
        "tasks.penalize": "COMPANY",

        // Obligations: an Admin creates, updates, decides and deletes their
        // company's. Reverting a decided one stays the Super Admin's.
        "obligations.view": "COMPANY",
        "obligations.manage": "COMPANY",

        // Requests: an Admin sees and decides their company's, decides
        // name changes, and resets performance points. Deleting a completed
        // request and resetting everyone's points stay the Super Admin's.
        "requests.view": "COMPANY",
        "requests.review": "COMPANY",
        "requests.reset_points": "COMPANY",
        "profile_requests.review": "COMPANY",

        // Clients, their sections and notes, and vendors: everything, in their
        // company. A person's cost history: anyone's in their company.
        "clients.view": "COMPANY",
        "clients.contribute": "COMPANY",
        "clients.edit": "COMPANY",
        "clients.delete": "COMPANY",
        "vendors.view": "COMPANY",
        "vendors.manage": "COMPANY",
        "costs.view": "COMPANY",

        // Settings: the company's own settings, but only the tabs the Super
        // Admin chooses to show it, and none until they switch that on
        // (ATTENDANCE_PLAN.md §5.2). Added by migration 20261006000000.
        "settings.view": "COMPANY",
        "settings.edit": "COMPANY",

        // Attendance: an Admin sees and corrects their company's attendance,
        // never their own (ATTENDANCE_PLAN.md §14). Opens nothing for a
        // company without the attendance add-on. Added by migration
        // 20261010000000.
        "attendance.view_team": "COMPANY",
        "attendance.correct": "COMPANY",
        // Deciding overtime and permission hours: added by migration 20261012000000.
        "attendance.approve_overtime": "COMPANY",
        "attendance.approve_permissions": "COMPANY",
        // Approving check-in phones: added by migration 20261021000000.
        "attendance.approve_devices": "COMPANY",
    },
    // A Team Leader sees their team in the employee list and can look each of
    // them up — TEAM scope, enforced by buildUserWhereClause and
    // verifyResourceAccess. Nothing else: they do not edit people, see
    // salaries, or see or decide their team's leave today.
    //
    // A person's own profile, payslips, leave requests and histories reach
    // them through owner rules on those routes, which are not permissions.
    TEAM_LEADER: {
        "employees.view": "TEAM",

        // The same task rights as an Admin, for their team's tasks — the team
        // rule itself is verifyResourceAccess('TASK') and checkAssignees.
        // (Bulk "mark paid" filtered by company only; Part B holds it to the
        // team too — lib/permissions/bulk-pay-scope.test.ts.)
        "tasks.view": "TEAM",
        "tasks.create": "TEAM",
        "tasks.edit": "TEAM",
        "tasks.transfer": "TEAM",
        "tasks.review": "TEAM",
        "tasks.delete": "TEAM",
        "tasks.pay": "TEAM",
        "tasks.penalize": "TEAM",

        // Obligations, for their team. Company-wide-only acts — removing other
        // people's attachments, the Admin delete path — follow from TEAM scope.
        "obligations.view": "TEAM",
        "obligations.manage": "TEAM",

        // Requests raised by their team.
        "requests.view": "TEAM",
        "requests.review": "TEAM",

        // Clients are company-wide: a leader adds to them and renames, but
        // does not delete. Vendors they read, to pick one for a task. They see
        // their own cost history as anyone does, not their team's.
        "clients.view": "COMPANY",
        "clients.contribute": "COMPANY",
        "clients.edit": "COMPANY",
        "vendors.view": "COMPANY",
    },
    // Everyone reads and adds to the company's clients.
    EMPLOYEE: {
        "clients.view": "COMPANY",
        "clients.contribute": "COMPANY",
    },
}

/**
 * A built-in role's grants as a session token carries them — what somebody on
 * that role holds until the Super Admin gives their company anything else.
 */
export function builtInGrantsToken(role: BuiltInRole): string {
    return encodeGrants(BUILT_IN_GRANTS[role])
}

export function isBuiltInRole(role: string | null | undefined): role is BuiltInRole {
    return role === "ADMIN" || role === "TEAM_LEADER" || role === "EMPLOYEE"
}
