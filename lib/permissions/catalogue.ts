import type { Module } from "@/lib/features/bundles"

/**
 * Every permission in the product, in one table.
 *
 * A permission only means something if code checks it, so this list is code,
 * not data: adding a feature means adding its permissions here, and a check
 * against a key that is not here fails to compile. Roles — which permissions a
 * person holds — are the part that will become data (ROLES_PLAN.md, Part B).
 * Until then, which built-in role holds what is fixed in ./built-in.ts.
 *
 * The same shape as MODULE_BUNDLE in lib/features/bundles.ts, for the same
 * reason: one table, and every caller — a route, a service, a screen — asking
 * the same question of it.
 *
 * Each entry records:
 * - `module`: the package module it belongs to, so a grant for a module the
 *   company has not bought can be shown as unavailable rather than silently
 *   doing nothing. `null` is Core, never gated.
 * - `scopes`: the scopes it may be granted at. Not merely "is it scopable" —
 *   an approval granted at OWN scope would look configured and do nothing,
 *   because nobody may approve their own request, so it is not offered.
 * - `highRisk`: why, when it moves money, gives it away or cannot be undone.
 *   These get a label in the role editor and a step-up MFA confirmation when
 *   used (ROLES_PLAN.md §6.15, not built yet).
 * - `implies`: permissions it is useless without. A role granted this is
 *   granted those too.
 *
 * Actions on one's own things — submitting a task assigned to you, requesting
 * leave, editing your own profile — are not permissions. Everybody may always
 * do them.
 */

export type Scope = "OWN" | "TEAM" | "COMPANY"

type PermissionDefinition = {
    /**
     * A stable number for the session token, which carries grants as codes
     * rather than key strings to stay far under the cookie limit (§4.4). Never
     * changed and never reused: a token issued before a release must not come
     * to mean something else after it. A removed permission's code goes into
     * RETIRED_CODES.
     */
    code: number
    module: Module | null
    scopes: readonly Scope[]
    /**
     * Planned, but nothing checks it yet: the screens and routes it would open
     * are the Super Admin's alone. Not offered in the permission matrix, and
     * refused when a role or template is saved, so no role promises access it
     * does not give. Remove when a route asks for it.
     */
    reserved?: true
    highRisk?: string
    implies?: readonly string[]
    /**
     * Never about oneself (ROLES_PLAN.md §4.2, rules 1, 5 and 6): nobody
     * approves their own leave, sets their own pay or allowance, decides their
     * own name change, or changes or requests their own role, whatever their
     * role holds. can() refuses it whenever the target
     * is the actor, so no route has to remember to.
     */
    notOnOwn?: true
}

const TEAM_OR_COMPANY = ["TEAM", "COMPANY"] as const
const COMPANY = ["COMPANY"] as const
const MOVES_MONEY = "Moves money"
const CANNOT_BE_UNDONE = "Cannot be undone"

export const PERMISSIONS = {
    // --- Employees --------------------------------------------------------
    "employees.view":           { code: 1, module: "EMPLOYEES", scopes: TEAM_OR_COMPANY },
    "employees.create":         { code: 2, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    "employees.edit":           { code: 3, module: "EMPLOYEES", scopes: TEAM_OR_COMPANY, implies: ["employees.view"] },
    "employees.change_status":  { code: 4, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    "employees.end_contract":   { code: 5, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"], highRisk: CANNOT_BE_UNDONE },
    "employees.delete":         { code: 6, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"], highRisk: CANNOT_BE_UNDONE },
    "employees.reset_password": { code: 7, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    "employees.assign_team":    { code: 8, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    // Nobody changes, or asks for, their own role (§4.2, rules 1 and 6).
    "employees.assign_role":    { code: 9, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"], notOnOwn: true },
    "employees.request_role":   { code: 10, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"], notOnOwn: true },

    // --- Profile requests and internal requests ---------------------------
    "profile_requests.review":  { code: 11, module: "PROFILE_REQUESTS", scopes: COMPANY, notOnOwn: true },
    "requests.view":            { code: 12, module: "REQUESTS", scopes: TEAM_OR_COMPANY },
    "requests.review":          { code: 13, module: "REQUESTS", scopes: TEAM_OR_COMPANY, implies: ["requests.view"] },
    "requests.reset_points":    { code: 14, module: "REQUESTS", scopes: COMPANY, implies: ["requests.view"] },

    // --- Tasks -------------------------------------------------------------
    "tasks.view":               { code: 15, module: "TASKS", scopes: TEAM_OR_COMPANY },
    "tasks.create":             { code: 16, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.edit":               { code: 17, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.transfer":           { code: 18, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.review":             { code: 19, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.delete":             { code: 20, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: CANNOT_BE_UNDONE },
    "tasks.pay":                { code: 21, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: MOVES_MONEY },
    "tasks.penalize":           { code: 22, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: "Affects pay" },

    // --- Obligations, clients, vendors, costs ------------------------------
    "obligations.view":         { code: 23, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY },
    "obligations.manage":       { code: 24, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY, implies: ["obligations.view"] },
    // Clients are a shared notebook as much as a register, so adding to it is
    // its own right, apart from renaming and deleting what is there.
    // contribute: add a client, a section or a note, and edit any note.
    // edit: rename a client or a section.
    "clients.view":             { code: 25, module: "CLIENTS", scopes: COMPANY },
    "clients.contribute":       { code: 26, module: "CLIENTS", scopes: COMPANY, implies: ["clients.view"] },
    "clients.edit":             { code: 27, module: "CLIENTS", scopes: COMPANY, implies: ["clients.view"] },
    "clients.delete":           { code: 28, module: "CLIENTS", scopes: COMPANY, implies: ["clients.view"], highRisk: CANNOT_BE_UNDONE },
    "vendors.view":             { code: 29, module: "VENDORS", scopes: COMPANY },
    "vendors.manage":           { code: 30, module: "VENDORS", scopes: COMPANY, implies: ["vendors.view"] },
    "costs.view":               { code: 31, module: "COSTS", scopes: COMPANY },

    // --- Day off -----------------------------------------------------------
    "dayoff.view":              { code: 32, module: "DAY_OFF", scopes: TEAM_OR_COMPANY },
    "dayoff.approve":           { code: 33, module: "DAY_OFF", scopes: TEAM_OR_COMPANY, implies: ["dayoff.view"], notOnOwn: true },
    "dayoff.adjust_credit":     { code: 34, module: "DAY_OFF", scopes: COMPANY, implies: ["dayoff.view"], notOnOwn: true },

    // --- Salaries ----------------------------------------------------------
    // One permission for seeing a salary anywhere — profile, history, payroll,
    // payslips (decided, ROLES_PLAN.md §3.2). Its module is settled when the
    // Employees screens migrate, since a salary is shown there too.
    "salary.view":              { code: 35, module: null, scopes: TEAM_OR_COMPANY },
    "salary.edit":              { code: 36, module: null, scopes: COMPANY, implies: ["salary.view"], highRisk: MOVES_MONEY, notOnOwn: true },
    "salary_adjustments.manage": { code: 37, module: "SALARY_ADJUSTMENTS", scopes: COMPANY, implies: ["salary.view"], highRisk: MOVES_MONEY, notOnOwn: true },

    // --- Payroll -----------------------------------------------------------
    "payroll.view":             { code: 38, module: "PAYROLL", scopes: COMPANY, implies: ["salary.view"] },
    "payroll.prepare":          { code: 39, module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"] },
    "payroll.approve":          { code: 40, module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"], highRisk: MOVES_MONEY },
    "payroll.issue_payslips":   { code: 41, module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"] },
    "payroll.mark_paid":        { code: 42, module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"], highRisk: MOVES_MONEY },
    "settlements.manage":       { code: 43, module: "PAYROLL", scopes: COMPANY, implies: ["salary.view"] },
    "debts.view":               { code: 44, module: "PAYROLL", scopes: COMPANY },
    "debts.waive":              { code: 45, module: "PAYROLL", scopes: COMPANY, implies: ["debts.view"], highRisk: MOVES_MONEY },

    // --- Settings and audit --------------------------------------------------
    // Reserved: company settings and the audit log are the Super Admin's pages.
    "settings.view":            { code: 46, module: null, scopes: COMPANY, reserved: true },
    "settings.edit":            { code: 47, module: null, scopes: COMPANY, implies: ["settings.view"], reserved: true },
    "audit.view":               { code: 48, module: null, scopes: COMPANY, reserved: true },
} as const satisfies Record<string, PermissionDefinition>

export type Permission = keyof typeof PERMISSIONS

/** Codes of permissions that no longer exist. Never handed out again. */
export const RETIRED_CODES: readonly number[] = []

const BY_CODE = new Map<number, Permission>(
    (Object.keys(PERMISSIONS) as Permission[]).map(p => [PERMISSIONS[p].code, p])
)

/** The permission a token code stands for, or undefined for an unknown code. */
export function permissionForCode(code: number): Permission | undefined {
    return BY_CODE.get(code)
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export function isPermission(value: string): value is Permission {
    return Object.prototype.hasOwnProperty.call(PERMISSIONS, value)
}

/** Whether a permission is planned but not yet checked anywhere (see `reserved`). */
export function isReserved(permission: Permission): boolean {
    return (PERMISSIONS[permission] as PermissionDefinition).reserved === true
}

export function definitionOf(permission: Permission): PermissionDefinition {
    return PERMISSIONS[permission]
}
