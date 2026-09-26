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
    module: Module | null
    scopes: readonly Scope[]
    highRisk?: string
    implies?: readonly string[]
}

const TEAM_OR_COMPANY = ["TEAM", "COMPANY"] as const
const COMPANY = ["COMPANY"] as const
const MOVES_MONEY = "Moves money"
const CANNOT_BE_UNDONE = "Cannot be undone"

export const PERMISSIONS = {
    // --- Employees --------------------------------------------------------
    "employees.view":           { module: "EMPLOYEES", scopes: TEAM_OR_COMPANY },
    "employees.create":         { module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    "employees.edit":           { module: "EMPLOYEES", scopes: TEAM_OR_COMPANY, implies: ["employees.view"] },
    "employees.change_status":  { module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    "employees.end_contract":   { module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"], highRisk: CANNOT_BE_UNDONE },
    "employees.delete":         { module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"], highRisk: CANNOT_BE_UNDONE },
    "employees.reset_password": { module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    "employees.assign_team":    { module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    "employees.assign_role":    { module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },
    "employees.request_role":   { module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },

    // --- Profile requests and internal requests ---------------------------
    "profile_requests.review":  { module: "PROFILE_REQUESTS", scopes: COMPANY },
    "requests.view":            { module: "REQUESTS", scopes: TEAM_OR_COMPANY },
    "requests.review":          { module: "REQUESTS", scopes: TEAM_OR_COMPANY, implies: ["requests.view"] },
    "requests.reset_points":    { module: "REQUESTS", scopes: COMPANY, implies: ["requests.view"] },

    // --- Tasks -------------------------------------------------------------
    "tasks.view":               { module: "TASKS", scopes: TEAM_OR_COMPANY },
    "tasks.create":             { module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.edit":               { module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.transfer":           { module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.review":             { module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.delete":             { module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: CANNOT_BE_UNDONE },
    "tasks.pay":                { module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: MOVES_MONEY },
    "tasks.penalize":           { module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: "Affects pay" },

    // --- Obligations, clients, vendors, costs ------------------------------
    "obligations.view":         { module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY },
    "obligations.manage":       { module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY, implies: ["obligations.view"] },
    "clients.view":             { module: "CLIENTS", scopes: COMPANY },
    "clients.manage":           { module: "CLIENTS", scopes: COMPANY, implies: ["clients.view"] },
    "vendors.view":             { module: "VENDORS", scopes: COMPANY },
    "vendors.manage":           { module: "VENDORS", scopes: COMPANY, implies: ["vendors.view"] },
    "costs.view":               { module: "COSTS", scopes: COMPANY },

    // --- Day off -----------------------------------------------------------
    "dayoff.view":              { module: "DAY_OFF", scopes: TEAM_OR_COMPANY },
    "dayoff.approve":           { module: "DAY_OFF", scopes: TEAM_OR_COMPANY, implies: ["dayoff.view"] },
    "dayoff.adjust_credit":     { module: "DAY_OFF", scopes: COMPANY, implies: ["dayoff.view"] },

    // --- Salaries ----------------------------------------------------------
    // One permission for seeing a salary anywhere — profile, history, payroll,
    // payslips (decided, ROLES_PLAN.md §3.2). Its module is settled when the
    // Employees screens migrate, since a salary is shown there too.
    "salary.view":              { module: null, scopes: TEAM_OR_COMPANY },
    "salary.edit":              { module: null, scopes: COMPANY, implies: ["salary.view"], highRisk: MOVES_MONEY },
    "salary_adjustments.manage": { module: "SALARY_ADJUSTMENTS", scopes: COMPANY, implies: ["salary.view"], highRisk: MOVES_MONEY },

    // --- Payroll -----------------------------------------------------------
    "payroll.view":             { module: "PAYROLL", scopes: COMPANY, implies: ["salary.view"] },
    "payroll.prepare":          { module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"] },
    "payroll.approve":          { module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"], highRisk: MOVES_MONEY },
    "payroll.issue_payslips":   { module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"] },
    "payroll.mark_paid":        { module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"], highRisk: MOVES_MONEY },
    "settlements.manage":       { module: "PAYROLL", scopes: COMPANY, implies: ["salary.view"] },
    "debts.view":               { module: "PAYROLL", scopes: COMPANY },
    "debts.waive":              { module: "PAYROLL", scopes: COMPANY, implies: ["debts.view"], highRisk: MOVES_MONEY },

    // --- Settings and audit --------------------------------------------------
    "settings.view":            { module: null, scopes: COMPANY },
    "settings.edit":            { module: null, scopes: COMPANY, implies: ["settings.view"] },
    "audit.view":               { module: null, scopes: COMPANY },
} as const satisfies Record<string, PermissionDefinition>

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export function isPermission(value: string): value is Permission {
    return Object.prototype.hasOwnProperty.call(PERMISSIONS, value)
}

export function definitionOf(permission: Permission): PermissionDefinition {
    return PERMISSIONS[permission]
}
