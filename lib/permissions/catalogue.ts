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
 * - `personal`: one's own, and nobody else's (see below).
 *
 * Actions on one's own things — submitting a task assigned to you, editing
 * your own profile — are not permissions. Everybody may always do them. Asking
 * for leave was one until a company could decide who may (UI_PLAN.md §2.3,
 * part 2a): it's a `personal` permission now.
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
     * Another area's permissions it can't work without (LATER_CHANGES_PLAN.md
     * §5.1 rule 1, §5.3; PR 372). Unlike `implies`, nothing is ticked for the
     * Super Admin, as across areas that would give access nobody chose: the
     * role editor greys it, "Needs ... first", until each is ticked, and
     * saving a role or template without one is refused (normalizeGrants).
     * Each is held at least as wide as what needs it, and a permission that
     * another held one brings with it carries no needs of its own
     * (grant-rules.ts, unmetNeeds).
     */
    requires?: readonly string[]
    /**
     * Other permissions it works without, but does less (LATER_CHANGES_PLAN.md
     * §5.1 rule 3, §5.3; PR 373): Create tasks without See clients can't pick
     * a client for a task. Saved, as a separation-of-duties pair is
     * (ROLES_PLAN.md §6.11): the role editor lists each one a role holds, one
     * a save newly brings is confirmed, and the server refuses it unconfirmed
     * and records the decision. Held at all counts, not how wide, and a
     * permission another held one brings with it warns of nothing
     * (grant-rules.ts, worksWithLess).
     */
    lessWithout?: readonly string[]
    /**
     * Never about oneself (ROLES_PLAN.md §4.2, rules 1, 5 and 6): nobody
     * approves their own leave, sets their own pay or allowance, decides their
     * own name change, or changes or requests their own role, whatever their
     * role holds. can() refuses it whenever the target
     * is the actor, so no route has to remember to.
     */
    notOnOwn?: true
    /**
     * Only ever about oneself: asking for one's own leave. It gives its holder
     * no reach over anybody, so a role holding it is no access its giver lacks
     * (ROLES_PLAN.md §4.2, rule 4), and covers() doesn't ask them to hold it:
     * an Admin who may not ask for leave still makes somebody an Employee, who
     * may.
     */
    personal?: true
}

const TEAM_OR_COMPANY = ["TEAM", "COMPANY"] as const
const COMPANY = ["COMPANY"] as const
const OWN = ["OWN"] as const
const MOVES_MONEY = "Moves money"
const CANNOT_BE_UNDONE = "Cannot be undone"
const LETS_OUTSIDERS_IN = "Lets outsiders in"

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
    // Changing when someone's contract started (LATER_CHANGES_PLAN.md §7.2,
    // PR 425): their hiring and starting salary move with it, so their pay
    // does. Never one's own, as one's own pay isn't.
    "employees.edit_contract_start": { code: 93, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"], notOnOwn: true, highRisk: "Affects pay" },
    // Marking someone as an owner, or taking it off (LATER_CHANGES_PLAN.md §7.3, PR 426): from the month
    // marked, no payslip and no attendance days.
    "employees.set_owner": { code: 94, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"], notOnOwn: true, highRisk: "Affects pay" },
    // Answering access reviews (LATER_CHANGES_PLAN.md §7.15, PR 439; ROLES_PLAN.md §6.14): the company's
    // reviews, a line confirmed or a change asked for, and being told when one opens. It was Assign roles'.
    // Nobody answers their own line, which AccessReviewService.answer keeps.
    "employees.review_access": { code: 95, module: "EMPLOYEES", scopes: COMPANY, implies: ["employees.view"] },

    // --- Profile requests and internal requests ---------------------------
    "profile_requests.review":  { code: 11, module: "PROFILE_REQUESTS", scopes: COMPANY, notOnOwn: true },
    "requests.view":            { code: 12, module: "REQUESTS", scopes: TEAM_OR_COMPANY },
    "requests.review":          { code: 13, module: "REQUESTS", scopes: TEAM_OR_COMPANY, implies: ["requests.view"] },
    "requests.reset_points":    { code: 14, module: "REQUESTS", scopes: COMPANY, implies: ["requests.view"], requires: ["employees.view"] },

    // --- Tasks -------------------------------------------------------------
    "tasks.view":               { code: 15, module: "TASKS", scopes: TEAM_OR_COMPANY },
    "tasks.create":             { code: 16, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], requires: ["locations.view"], lessWithout: ["clients.view"] },
    "tasks.edit":               { code: 17, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.transfer":           { code: 18, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.review":             { code: 19, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"] },
    "tasks.delete":             { code: 20, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: CANNOT_BE_UNDONE },
    "tasks.pay":                { code: 21, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: MOVES_MONEY },
    "tasks.penalize":           { code: 22, module: "TASKS", scopes: TEAM_OR_COMPANY, implies: ["tasks.view"], highRisk: "Affects pay" },
    // The company's saved lists of cost names and task titles (CLIENTS_PLAN.md
    // §5.7): adding a name to one, as "+ Add" does, and changing them, split
    // from lists.manage by what is done (LATER_CHANGES_PLAN.md §2, PR 379):
    // renaming a name, merging one into another, and archiving or restoring
    // one. lists.manage, retired in PR 386, included adding; none of its
    // parts does, as none needs it.
    "lists.add":                { code: 58, module: "TASKS", scopes: COMPANY },
    "lists.rename":             { code: 82, module: "TASKS", scopes: COMPANY },
    "lists.merge":              { code: 83, module: "TASKS", scopes: COMPANY },
    "lists.archive":            { code: 84, module: "TASKS", scopes: COMPANY },

    // --- Obligations, records, clients, costs ------------------------------
    "obligations.view":         { code: 23, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY },
    // Split by what can be done to one (LATER_CHANGES_PLAN.md §2, PR 367):
    // adding it; handing it to other people, moving it along and removing
    // others' attachments; approving or rejecting it, or changing one
    // approved; and deleting it. Its details don't change once it's made.
    "obligations.create":       { code: 75, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY, implies: ["obligations.view"], lessWithout: ["clients.view"] },
    "obligations.edit":         { code: 76, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY, implies: ["obligations.view"] },
    "obligations.approve":      { code: 77, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY, implies: ["obligations.view"] },
    "obligations.delete":       { code: 78, module: "OBLIGATIONS", scopes: TEAM_OR_COMPANY, implies: ["obligations.view"] },
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
    // Split by what it does (LATER_CHANGES_PLAN.md §2, PR 365): adding a
    // client; changing its details and picking its responsible accountant;
    // and deleting or archiving one, deleting an archived one for good and
    // restoring one from the archive, which undoes archiving.
    "clients.create":           { code: 72, module: "CLIENTS", scopes: COMPANY, implies: ["clients.view"] },
    "clients.edit":             { code: 73, module: "CLIENTS", scopes: COMPANY, implies: ["clients.view"] },
    "clients.delete":           { code: 74, module: "CLIENTS", scopes: COMPANY, implies: ["clients.view"] },
    // The places tasks happen at (CLIENTS_PLAN.md §2.9): seeing them, adding
    // one (as the task form does), and changing them, split from
    // locations.manage by what is done (LATER_CHANGES_PLAN.md §2, PR 377):
    // editing one (its name, pin and radius, and which is a client's HQ),
    // and archiving or restoring one. Each includes seeing. Adding was
    // locations.add until PR 378, which the owner asked to be named
    // locations.create as the other areas' adding is: done as a split into
    // one, and retired in PR 386.
    "locations.view":           { code: 55, module: "CLIENTS", scopes: COMPANY },
    "locations.create":         { code: 81, module: "CLIENTS", scopes: COMPANY, implies: ["locations.view"] },
    "locations.edit":           { code: 79, module: "CLIENTS", scopes: COMPANY, implies: ["locations.view"] },
    "locations.archive":        { code: 80, module: "CLIENTS", scopes: COMPANY, implies: ["locations.view"] },
    "costs.view":               { code: 31, module: "COSTS", scopes: COMPANY, requires: ["employees.view"] },
    // A task's costs charged to its client (CLIENTS_PLAN.md §6.6): seeing
    // them; setting them, which is the service fee and leaving one off the
    // client's bill; and marking them collected, which moves money. Setting
    // was charges.manage until PR 380, named charges.set as the table splits
    // it, as a split into one: collecting already had its own.
    "charges.view":             { code: 60, module: "COSTS", scopes: TEAM_OR_COMPANY },
    "charges.set":              { code: 85, module: "COSTS", scopes: COMPANY, implies: ["charges.view"] },
    "charges.collect":          { code: 62, module: "COSTS", scopes: COMPANY, implies: ["charges.view"], highRisk: MOVES_MONEY },
    // An employee's cash advance (CLIENTS_PLAN.md §7.7): seeing their team's
    // or the company's, and giving and settling them, with returns and
    // corrections, which moves money. Everyone sees their own, on My cash
    // advance, so that isn't a permission; nobody gives or settles their own
    // (§7.8).
    "cash_advances.view":       { code: 63, module: "COSTS", scopes: TEAM_OR_COMPANY },
    "cash_advances.give":       { code: 64, module: "COSTS", scopes: COMPANY, implies: ["cash_advances.view"], highRisk: MOVES_MONEY, notOnOwn: true },

    // --- Client portal (CLIENT_PORTAL_PLAN.md §9) ----------------------------
    // A client's tax position: what it owes on the Tax Authority's portal,
    // from the portal's file. It's on the client's page, so it's useless
    // without seeing clients.
    "tax.view":                 { code: 68, module: "TAX_POSITION", scopes: COMPANY, implies: ["clients.view"] },
    // Keeping it up to date: uploading the portal's file, which replaces the
    // client's claims (§4.1). Useless without seeing what it replaces.
    "tax.manage":               { code: 69, module: "TAX_POSITION", scopes: COMPANY, implies: ["tax.view"] },
    // A client's people who sign in to the client portal (§5.2): seeing
    // them, inviting one (adding them, and sending their invitation again),
    // and removing one, split from client_accounts.manage by what is done
    // (LATER_CHANGES_PLAN.md §2, PR 381). They're on the client's page, so
    // seeing them is useless without seeing clients, and inviting or
    // removing one without seeing them. Inviting lets someone from outside
    // the company in, so it asks for the step-up confirmation; removing
    // takes access away, and doesn't.
    "client_accounts.view":     { code: 86, module: "TAX_POSITION", scopes: COMPANY, implies: ["clients.view"] },
    "client_accounts.invite":   { code: 87, module: "TAX_POSITION", scopes: COMPANY, implies: ["client_accounts.view"], highRisk: LETS_OUTSIDERS_IN },
    "client_accounts.remove":   { code: 88, module: "TAX_POSITION", scopes: COMPANY, implies: ["client_accounts.view"] },
    // The company's own copy of the client messages on WhatsApp (§7.1):
    // reading them, changing one, and going back to Nizmo's. It brings
    // nothing with it: the Client portal tab shows to whoever holds it,
    // whatever the company's Admin access says. Not high-risk: the client's
    // person can still change a message before sending it.
    "client_messages.manage":   { code: 71, module: "TAX_POSITION", scopes: COMPANY },

    // --- Day off -----------------------------------------------------------
    "dayoff.view":              { code: 32, module: "DAY_OFF", scopes: TEAM_OR_COMPANY },
    "dayoff.approve":           { code: 33, module: "DAY_OFF", scopes: TEAM_OR_COMPANY, implies: ["dayoff.view"], notOnOwn: true },
    "dayoff.adjust_credit":     { code: 34, module: "DAY_OFF", scopes: COMPANY, implies: ["dayoff.view"], notOnOwn: true, requires: ["employees.view"] },
    // Asking for leave of one's own (UI_PLAN.md §2.3, part 2a): given to a
    // role or not, as the Requests page offers a day off only to those who
    // may ask. Only ever one's own, so its scope is too.
    "dayoff.request":           { code: 65, module: "DAY_OFF", scopes: OWN, personal: true },

    // --- Salaries ----------------------------------------------------------
    // One permission for seeing a salary anywhere — profile, history, payroll,
    // payslips (decided, ROLES_PLAN.md §3.2). Its module is settled when the
    // Employees screens migrate, since a salary is shown there too.
    "salary.view":              { code: 35, module: null, scopes: TEAM_OR_COMPANY, lessWithout: ["employees.view"] },
    "salary.edit":              { code: 36, module: null, scopes: COMPANY, implies: ["salary.view"], highRisk: MOVES_MONEY, notOnOwn: true, requires: ["employees.view"] },
    // Bonuses and deductions on someone's month: adding one, and undoing one
    // (rolled back as a mistake, or reversed as right when it was made),
    // split from salary_adjustments.manage by what is done to the pay
    // (LATER_CHANGES_PLAN.md §2, PR 382). Each moves money, so each asks for
    // the step-up confirmation; each is never on one's own pay; and neither
    // includes the other, as undoing one doesn't need adding one.
    "salary_adjustments.add":   { code: 89, module: "SALARY_ADJUSTMENTS", scopes: COMPANY, implies: ["salary.view"], highRisk: MOVES_MONEY, notOnOwn: true, requires: ["employees.view"] },
    "salary_adjustments.reverse": { code: 90, module: "SALARY_ADJUSTMENTS", scopes: COMPANY, implies: ["salary.view"], highRisk: MOVES_MONEY, notOnOwn: true, requires: ["employees.view"] },

    // --- Payroll -----------------------------------------------------------
    "payroll.view":             { code: 38, module: "PAYROLL", scopes: COMPANY, implies: ["salary.view"] },
    "payroll.prepare":          { code: 39, module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"] },
    "payroll.approve":          { code: 40, module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"], highRisk: MOVES_MONEY },
    "payroll.issue_payslips":   { code: 41, module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"] },
    "payroll.mark_paid":        { code: 42, module: "PAYROLL", scopes: COMPANY, implies: ["payroll.view"], highRisk: MOVES_MONEY },
    // Someone's final settlements: seeing them, in their history and on the
    // statement, and sending the statement by email, or again, split from
    // settlements.manage by what is done (LATER_CHANGES_PLAN.md §2, PR 383).
    // Sending is from the statement, so it includes seeing it. A statement
    // moves no money, so neither asks for the step-up confirmation.
    "settlements.view":         { code: 91, module: "PAYROLL", scopes: COMPANY, implies: ["salary.view"], requires: ["employees.view"] },
    "settlements.resend":       { code: 92, module: "PAYROLL", scopes: COMPANY, implies: ["settlements.view"], requires: ["employees.view"] },
    "debts.view":               { code: 44, module: "PAYROLL", scopes: COMPANY, requires: ["employees.view"] },
    "debts.waive":              { code: 45, module: "PAYROLL", scopes: COMPANY, implies: ["debts.view"], highRisk: MOVES_MONEY, requires: ["payroll.view"] },

    // --- Settings and audit --------------------------------------------------
    // A company's settings, the tabs the Super Admin shows it
    // (ATTENDANCE_PLAN.md §5.2, lib/company-settings-access.ts). Reserved:
    // the audit log is the Super Admin's page.
    "settings.view":            { code: 46, module: null, scopes: COMPANY },
    "settings.edit":            { code: 47, module: null, scopes: COMPANY, implies: ["settings.view"], lessWithout: ["salary.view"] },
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
    // Setting fingerprint terminals up (§17.10): everything under Fingerprint
    // terminals, agents and their codes, terminals and retiring them. An
    // agent's code lets punches in for any employee number, and so into pay.
    // The section is on the Attendance settings tab, which needs
    // settings.view to open. It opens only where the Super Admin lets the
    // company set its own terminals up (Company.terminalsSetupByCompany).
    "attendance.manage_terminals":    { code: 66, module: "ATTENDANCE", scopes: COMPANY, implies: ["settings.view"], highRisk: "Affects pay" },
    // Deciding missions (§6.10, PR 283): approving or rejecting one asked
    // for. Never one's own. Not high-risk, as deciding permission hours and
    // overtime isn't.
    "attendance.approve_missions":    { code: 67, module: "ATTENDANCE", scopes: TEAM_OR_COMPANY, implies: ["attendance.view_team"], notOnOwn: true },
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
 *
 * 4: lists.* (codes 58–59), for the saved lists of cost names and task
 * titles (CLIENTS_PLAN.md §5.7).
 *
 * Not raised for dayoff.request (code 65, UI_PLAN.md §2.3, part 2a): no role
 * already there holds it until a later release's migration, and every
 * release live by then knows it.
 *
 * Nor for attendance.manage_terminals (code 66, ATTENDANCE_PLAN.md §17.10,
 * PR 277), for the same reason, nor attendance.approve_missions (code 67,
 * §6.10, PR 283).
 *
 * Nor for tax.view (code 68, CLIENT_PORTAL_PLAN.md §9, PR 311): no role
 * already there holds it until its own migration gives it. Nor for
 * tax.manage (code 69, PR 315), as for tax.view, nor
 * client_accounts.manage (code 70, PR 322), nor client_messages.manage
 * (code 71, PR 348).
 *
 * 5: clients.create, clients.edit and clients.delete (codes 72–74), split
 * from clients.manage (LATER_CHANGES_PLAN.md §2, PR 365). Every role that
 * held clients.manage holds them from now, as its parts: a session reloads
 * once to carry them, as the routes ask for them alone.
 *
 * 6: obligations.create, obligations.edit, obligations.approve and
 * obligations.delete (codes 75–78), split from obligations.manage the same
 * way (PR 367), each at the scope obligations.manage was held at.
 *
 * 7: locations.edit and locations.archive (codes 79–80), split from
 * locations.manage the same way (PR 377). Adding one stays locations.add.
 *
 * 8: locations.create (code 81), locations.add renamed as a split into one
 * (PR 378).
 *
 * 9: lists.rename, lists.merge and lists.archive (codes 82–84), split from
 * lists.manage (PR 379). Adding one stays lists.add.
 *
 * 10: charges.set (code 85), charges.manage named as a split into one
 * (PR 380).
 *
 * 11: client_accounts.view, client_accounts.invite and
 * client_accounts.remove (codes 86–88), split from client_accounts.manage
 * (PR 381).
 *
 * 12: salary_adjustments.add and salary_adjustments.reverse (codes 89–90),
 * split from salary_adjustments.manage (PR 382).
 *
 * 13: settlements.view and settlements.resend (codes 91–92), split from
 * settlements.manage (PR 383).
 *
 * Not raised for retiring the nine split permissions (PR 386): every token
 * issued since each split's own raise holds their parts, never them.
 *
 * 14: employees.edit_contract_start (code 93, LATER_CHANGES_PLAN.md §7.2,
 * PR 425), which its own migration gives each company's Admin role: a
 * token the release before refreshed after it ran reloads once to hold it.
 *
 * 15: employees.set_owner (code 94, LATER_CHANGES_PLAN.md §7.3, PR 426), the
 * same way.
 *
 * 16: employees.review_access (code 95, LATER_CHANGES_PLAN.md §7.15, PR 439),
 * which its own migration gives every role holding employees.assign_role.
 */
export const CATALOGUE_VERSION = 16

/**
 * Permissions that no longer exist, by name, with the code each had: never
 * handed out again (RETIRED_CODES), and still named in words where a record
 * kept them, such as an audit log entry or an access review
 * (matrix.ts, namedPermissionKey).
 *
 * The nine split by what they do (LATER_CHANGES_PLAN.md §2): retired in PR
 * 386, once the grant for companies already there (PR 385) wrote their parts
 * in every role and template.
 */
export const RETIRED = {
    "obligations.manage": 24, "clients.manage": 30, "salary_adjustments.manage": 37, "settlements.manage": 43,
    "locations.add": 56, "locations.manage": 57, "lists.manage": 59, "charges.manage": 61, "client_accounts.manage": 70,
} as const

export type RetiredPermission = keyof typeof RETIRED

/** Codes of permissions that no longer exist. Never handed out again. */
export const RETIRED_CODES: readonly number[] = Object.values(RETIRED)

/** Whether a name is a permission that no longer exists (see `RETIRED`). */
export function isRetired(value: string): value is RetiredPermission {
    return Object.prototype.hasOwnProperty.call(RETIRED, value)
}

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

/** Whether a permission is only ever about oneself (see `personal`). */
export function isPersonal(permission: Permission): boolean {
    return (PERMISSIONS[permission] as PermissionDefinition).personal === true
}

/** Another area's permissions this one can't work without (see `requires`). */
export function requiresOf(permission: Permission): readonly Permission[] {
    return ((PERMISSIONS[permission] as PermissionDefinition).requires ?? []) as readonly Permission[]
}

/** Other permissions this one works without, but does less (see `lessWithout`). */
export function lessWithoutOf(permission: Permission): readonly Permission[] {
    return ((PERMISSIONS[permission] as PermissionDefinition).lessWithout ?? []) as readonly Permission[]
}

/** Whether a permission is planned but not yet checked anywhere (see `reserved`). */
export function isReserved(permission: Permission): boolean {
    return (PERMISSIONS[permission] as PermissionDefinition).reserved === true
}

export function definitionOf(permission: Permission): PermissionDefinition {
    return PERMISSIONS[permission]
}
