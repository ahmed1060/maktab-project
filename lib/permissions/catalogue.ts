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

    // --- Obligations, records, clients, costs ------------------------------
    "obligations.view":         { code: 23, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY },
    "obligations.manage":       { code: 24, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY, implies: ["obligations.view"] },
    // A client's records (CLIENTS_PLAN.md §0.2) are a shared notebook as much
    // as a register, so adding to them is its own right, apart from renaming
    // and deleting what is there.
    // contribute: add a section or a record, and edit any record.
    // edit: rename a section.
    // These were clients.*, for the old Clients section, with the same codes
    // and meaning (CLIENTS_PLAN.md §0.2).
    "records.view":             { code: 25, module: "RECORDS", scopes: COMPANY },
    "records.contribute":       { code: 26, module: "RECORDS", scopes: COMPANY, implies: ["records.view"] },
    "records.edit":             { code: 27, module: "RECORDS", scopes: COMPANY, implies: ["records.view"] },
    "records.delete":           { code: 28, module: "RECORDS", scopes: COMPANY, implies: ["records.view"], highRisk: CANNOT_BE_UNDONE },
    // These were vendors.*, with the same codes and meaning
    // (CLIENTS_PLAN.md §0.3).
    "clients.view":             { code: 29, module: "CLIENTS", scopes: COMPANY },
    "clients.manage":           { code: 30, module: "CLIENTS", scopes: COMPANY, implies: ["clients.view"] },
    // The places tasks happen at (CLIENTS_PLAN.md §2.9): seeing them, adding
    // one (as the task form will), and managing them (pin and radius,
    // archiving, which is a client's HQ). Adding or managing includes seeing.
    "locations.view":           { code: 55, module: "CLIENTS", scopes: COMPANY },
    "locations.add":            { code: 56, module: "CLIENTS", scopes: COMPANY, implies: ["locations.view"] },
    "locations.manage":         { code: 57, module: "CLIENTS", scopes: COMPANY, implies: ["locations.view"] },
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
    // A company's settings, the tabs the Super Admin shows it
    // (ATTENDANCE_PLAN.md §5.2, lib/company-settings-access.ts). Reserved:
    // the audit log is the Super Admin's page.
    "settings.view":            { code: 46, module: null, scopes: COMPANY },
    "settings.edit":            { code: 47, module: null, scopes: COMPANY, implies: ["settings.view"] },
    "audit.view":               { code: 48, module: null, scopes: COMPANY, reserved: true },

    // --- Attendance (ATTENDANCE_PLAN.md §4.1, §14) ---------------------------
    // view_team: other people's punches and days. Everybody sees their own.
    // correct: bring punches in from a file, add or withdraw one by hand, and
    // say which person a terminal's employee number is. Nobody corrects their
    // own attendance (§4.3). Not high-risk: it is daily work, each change is
    // audited with its reason, and none reaches a month whose payroll is
    // approved — step-up on every forgotten punch would teach people to click
    // through it.
    "attendance.view_team":     { code: 49, module: "ATTENDANCE", scopes: TEAM_OR_COMPANY },
    "attendance.correct":       { code: 50, module: "ATTENDANCE", scopes: TEAM_OR_COMPANY, implies: ["attendance.view_team"], notOnOwn: true },
    // Deciding requests (§6.4, §6.6): overtime — after the fact or ahead of
    // it — and permission hours (إذن). A missing punch is a correction, so it
    // is attendance.correct's to decide. Never one's own.
    "attendance.approve_overtime":    { code: 51, module: "ATTENDANCE", scopes: TEAM_OR_COMPANY, implies: ["attendance.view_team"], notOnOwn: true },
    "attendance.approve_permissions": { code: 52, module: "ATTENDANCE", scopes: TEAM_OR_COMPANY, implies: ["attendance.view_team"], notOnOwn: true },
    // Approving the one phone someone checks in from (§9.3), and revoking a
    // lost one. Never one's own: approving your own phone is the whole fraud.
    "attendance.approve_devices":     { code: 53, module: "ATTENDANCE", scopes: TEAM_OR_COMPANY, implies: ["attendance.view_team"], notOnOwn: true },
    // Face verification (§9.5): turning it on for a person, deciding their
    // verification photo, asking for re-verification. Company-wide only: the
    // photo is shown to the Admin, HR and the Super Admin, never to a team
    // leader. Never one's own: approving your own face is the whole fraud.
    "attendance.approve_face":        { code: 54, module: "ATTENDANCE", scopes: COMPANY, implies: ["attendance.view_team"], notOnOwn: true },
} as const satisfies Record<string, PermissionDefinition>

export type Permission = keyof typeof PERMISSIONS

/**
 * Which release of this catalogue a session's grants were read against.
 * Raised whenever permissions are added or renamed: a session token made
 * against an earlier one reloads its grants once (lib/auth.ts), whatever
 * its role's version says. Preview builds migrate the production database
 * before the release that reads it is live, so the older release may
 * already have refreshed a token at the new role version, dropping the
 * permissions it didn't know (Codex on #82).
 *
 * 2: records.* (codes 25–28), renamed from clients.* (CLIENTS_PLAN.md §0.2).
 *
 * Not raised for clients.* (codes 29–30), renamed from vendors.* in 0b–0d:
 * every release in between read either name as the same code, so no token
 * lost them.
 *
 * 3: locations.* (codes 55–57), for the places tasks happen at
 * (CLIENTS_PLAN.md §2.9).
 */
export const CATALOGUE_VERSION = 3

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
