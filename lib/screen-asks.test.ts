import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, resolve, relative } from "node:path"
import { PERMISSIONS, requiresOf, type Permission } from "./permissions/catalogue"

/**
 * What each screen asks the server for, against the permission that opens it
 * (LATER_CHANGES_PLAN.md §5.1 "Kept true", §5.2 step 5; PR 376), so a screen
 * that quietly needs another permission fails here, not in front of someone
 * whose role holds only the one that opens it.
 *
 * A table, checked against the code both ways:
 * - each screen's calls, each a method and a path, found in its page and the
 *   components and hooks it uses, are the table's, no more and no fewer: a
 *   new call, or a new method at a path already there, fails until it's
 *   written down;
 * - each call is **needed** whenever the screen is open, its route answering
 *   any of the permissions named; asked only **when** the viewer holds one,
 *   with the code that decides it quoted (`gates`), in the screen, or in the
 *   server where it gives a button what it needs only for its holders; open
 *   to **anyone** in the company; or the **Super Admin's** only, with its
 *   gates too; or **not here**, in a component the screen uses but never
 *   sent from it, with the code that shows why (PR 387). That method's
 *   handler names each permission given, and each gate is in the code, as
 *   quoted, naming its permission;
 * - a needed call is met by each permission that opens the screen: itself,
 *   one it brings (`implies`), or one it needs first (`requires`), as rules 1
 *   and 2 keep those held with it. A screen **anyone** in the company opens,
 *   showing each person what they may see, needs nothing (PR 387).
 *
 * In parts: first the screens the remaining splits change (§2, PR 376), so
 * each split kept its rows; then the task screens (PR 387); then the
 * obligation, record and document screens (PR 388); then Requests (PR 389);
 * then the people screens (PR 390); then attendance (PR 391); then check-in
 * (PR 393); then settings and the home page (PR 395), the last.
 */

/**
 * Where a screen decides to ask: code in one of its own files, or, where the
 * server decides by giving a button what it needs only for its holders, code
 * in that file.
 */
type Gate = string | { in: string; code: string }
/**
 * `routes` narrows a call reaching several routes, as one built from a
 * variable does; `routeChecks`, where the route checks when its handler
 * doesn't itself, as when a service does: one file, or each that names one
 * of the permissions given (PR 395).
 */
type Where = { routes?: string[]; routeChecks?: string | string[] }
/**
 * A "when" whose route answers a permission the gate's brings, rather than
 * the gate's own, says which (`answers`): the leaders a new employee can be
 * put under, asked for whoever assigns teams, and answered for See employees,
 * which Assign teams brings.
 */
type Ask =
    | ({ needs: Permission[] } & Where)
    | ({ when: Permission[]; gates: Gate[]; answers?: Permission[] } & Where)
    | ({ superAdmin: Gate[] } & Where)
    | ({ notHere: Gate[] } & Where)
    | "anyone"

/** What opens a screen: its permissions, or, where anyone in the company may and is shown what they may see, anyone. */
type Screen = { opens: Permission[] | "anyone"; asks: Record<string, Ask> }

const ANYONE = "anyone" as const
const needs = (...permissions: Permission[]): Ask => ({ needs: permissions })
const when = (permission: Permission | Permission[], ...gates: Gate[]): Ask => ({ when: [permission].flat(), gates })
const superAdmin = (...gates: Gate[]): Ask => ({ superAdmin: gates })
/** In a component the screen uses, but never sent from this screen, for the reason quoted. */
const notHere = (...gates: Gate[]): Ask => ({ notHere: gates })

// Shared by several screens: the components' own checks.
const CLIENT_PICKERS = ["useClientOptions(onePage && can('clients.view'), true)", "const clients = useClientOptions(choosing && can('clients.view'))"]
const PLACE_FILTERS = ["const seesClients = can('clients.view') && !waits", "const seesLocations = placed && can('locations.view') && !waits"]
const LOCATION_COMPANY = "const pickCompany = choosing && sharedChosen && superAdmin && !selectedCompanyId"
const CHARGE_FEE = ["const canSet = can('charges.set')", ": !canSet ? [] : c.notCharged"]
const CHARGE_COLLECT = ["const canCollect = can('charges.collect')", "{canCollect && offer && <Button"]
const CHARGE_UNCOLLECT = ["const canCollect = can('charges.collect')", "? (canCollect ? [{ key: 'uncollect'"]
// A client's people: seen with client_accounts.view, each change with its own part (PR 381).
const PEOPLE_MAY = "const may = { invite: can('client_accounts.invite'), remove: can('client_accounts.remove') }"
const LOCATION_CHANGE = ["const canEdit = can('locations.edit')", "const canArchive = can('locations.archive')", "locationActions(l, { edit: canEdit, archive: canArchive })"]
// A task's place (components/locations/TaskPlacePicker.tsx): its client and places for whoever sees them, a new place for whoever adds them.
const TASK_PLACE_CLIENTS = ["const seesClients = can('clients.view')", "const clients = useClientOptions(choosing && can('clients.view'))"]
const TASK_PLACE_LOCATIONS = "const seesLocations = can('locations.view')"
const TASK_PLACE_NEW = "{can('locations.create') && ("
// The picker opens the place form only to add one, for the task, so the form's editing is never sent from it.
const TASK_PLACE_NO_EDIT = notHere("forTask={{ clientId: value.clientId || null, clientName, companyId }}", { in: "components/locations/LocationForm.tsx", code: "method: editing ? 'PUT' : 'POST'" })
// The request feed gives each row what may be done with it, for whoever may (lib/requests/feed.ts, PR 389).
const FEED = "lib/requests/feed.ts"
const feed = (code: string): Gate => ({ in: FEED, code })
// What a profile offers, each for whoever may (lib/profile-access.ts, PR 390).
const profile = (code: string): Gate => ({ in: "lib/profile-access.ts", code })
const ASKS_ROLE = profile(": can('employees.request_role') ? 'ask'")
// A saved name added from where it's typed (components/lists/useListNames.ts).
const LIST_ADD = "return { suggest, onAdd: can('lists.add') && (!superAdmin || !!company) ? add : undefined }"

/**
 * The names-only list a picker that hands work to someone asks (PR 371), its path built by lib/assignees-url.ts and so
 * found since PR 394: the route answers the permission named in `for`, one of its list, for whoever holds it.
 */
const ASSIGNEES = "app/api/assignees/route.ts"

/**
 * Attendance's (PR 391): its Requests tab imports two of Requests' dialogs, asking for a permission and reporting a
 * missing punch, from the file that also decides and withdraws, so the rest of that file's calls aren't made here.
 */
const ASKING_DIALOGS = notHere("import { AskPermission, ReportMissingPunch } from '../requests/AttendanceDialogs'")
const PUNCH_ACCESS = "lib/attendance/punch-access.ts"
const CORRECTS_COMPANY = "const correctsCompany = p.companyWide('attendance.correct')"
const CORRECTS_ROW = "const corrects = (row: { userId: string; teamLeaderId: string | null }) => row.userId !== me && p.canFor('attendance.correct', row.userId, row.teamLeaderId)"
const FACE_TAB = ["...(p.companyWide('attendance.approve_face') ? ['face' as const] : []),", "{tab === 'face' && <FaceTab q={q} />}"]
/**
 * Settings' (PR 395): the tabs the server shows each person, read with See settings, saved with Edit settings; the
 * client portal's with its own permission; and the Super Admin's tabs never, as the page refuses them and the server
 * never shows those to anyone else.
 */
const SETTINGS_ACCESS = "lib/company-settings-access.ts"
const SHOWS_TABS: Gate = { in: SETTINGS_ACCESS, code: 'const exposed: string[] = can(actor, "settings.view", { companyId: company.id }) ? exposedTabs(company) : []' }
const EDITS: Gate[] = [{ in: "app/api/company-settings/route.ts", code: 'canEdit: can(session.user, "settings.edit", { companyId }),' }, "readOnly={!canEdit}"]
const EDITS_ATTENDANCE: Gate[] = [...EDITS, "const editable = !readOnly && !!data?.canEdit"]
const ATTENDANCE_TAB: Gate[] = [SHOWS_TABS, "{tab === 'attendance' && ("]
// The Payroll tab's second card, payroll deductions (LATER_CHANGES_PLAN.md §7.12, PR 440): its own route, asked what the tab's fields are.
const PAYROLL_TAB: Gate[] = [SHOWS_TABS, "{tab === 'payroll' && ("]
const TERMINALS = "lib/attendance/terminals-access.ts"
const MANAGES_TERMINALS: Gate[] = [{ in: TERMINALS, code: 'return company.terminalsSetupByCompany && can(actor, "attendance.manage_terminals", { companyId: company.id })' }, "{data.sections.terminals && <AttendanceTerminalsPanel"]
// Roles and access's two tabs, each for whoever holds its permission (LATER_CHANGES_PLAN.md §7.15, PR 439).
const CHANGES_TAB: Gate = { in: "lib/roles-and-access.ts", code: "if (can('employees.assign_role')) tabs.push('changes')" }
const REVIEWS_TAB: Gate = { in: "lib/roles-and-access.ts", code: "if (can('employees.review_access')) tabs.push('reviews')" }
const CLIENT_PORTAL_TAB: Gate[] = [{ in: "lib/company-settings-tabs.ts", code: 'module: "TAX_POSITION", permission: "client_messages.manage",' }, "{tab === 'client_portal' && <>"]
const SUPER_ADMINS_TAB = notHere("if (superAdmin || refused) return <AccessDenied />", "superAdmin={false}",
    { in: SETTINGS_ACCESS, code: "export const ELIGIBLE_SETTINGS_TABS = COMPANY_SETTINGS_TABS.filter(t => t.adminEligible)" })
const edits = (...extra: Gate[]): Ask => ({ when: ["settings.edit"], routeChecks: SETTINGS_ACCESS, gates: [...EDITS_ATTENDANCE, ...extra] })
const reads: Ask = { when: ["settings.view"], routeChecks: SETTINGS_ACCESS, gates: ATTENDANCE_TAB }
const terminals: Ask = { when: ["attendance.manage_terminals"], routeChecks: TERMINALS, gates: MANAGES_TERMINALS }
const portal: Ask = { when: ["client_messages.manage"], gates: CLIENT_PORTAL_TAB }

/** Check-in's (PR 393): it imports one dialog from attendance's Requests tab, asking for a permission when late. */
const LATE_ASKING = notHere("import { AskPermissionDialog } from '../attendance/RequestsTab'")

const SCREENS: Record<string, Screen> = {
    // The task screens (PR 387).
    "tasks": {
        // Everyone's, showing each their own tasks, and their team's or the company's with See tasks.
        opens: ANYONE,
        asks: {
            "GET /api/clients": when("clients.view", ...PLACE_FILTERS),
            "GET /api/locations": when("locations.view", ...PLACE_FILTERS),
            "GET /api/users": when("employees.view", "const asks = on && can('employees.view')"),
            "GET /api/lists": ANYONE,
            "GET /api/realtime/token": ANYONE,
        },
    },
    "tasks/[id]": {
        // Each task for its assignees, and for whoever sees it with See tasks.
        opens: ANYONE,
        asks: {
            // An assignee's: what changed seen, and their work sent in. The server checks they're on the task.
            "PUT /api/tasks/[x]/acknowledge": ANYONE,
            "PUT /api/tasks/[x]/submit": ANYONE,
            // Who to transfer it to: from its menu, or when someone it was given to is gone.
            "GET /api/assignees": { when: ["tasks.transfer"], routeChecks: ASSIGNEES,
                gates: ["const canTransfer = can('tasks.transfer')", "const transferable = !isRestricted && canTransfer && ['IN_PROGRESS', 'PENDING'].includes(task.status)",
                    "{deleted.length > 0 && canTransfer && !DECIDED.includes(task.status) && ("] },
            // Removing a note, file or cost: one's own, or anyone's with Edit tasks, decided item by item by the server.
            "DELETE /api/tasks/[x]/items": ANYONE,
            "DELETE /api/tasks/[x]/locations": ANYONE,
            // One's own cash advance, while adding a cost.
            "GET /api/cash-advances/[x]": ANYONE,
            "GET /api/company-settings/visible": ANYONE,
            "POST /api/tasks/[x]/review": when("tasks.review", "const reviewing = !isRestricted && mayManage('tasks.review') && task.status === 'PENDING_CONFIRMATION'"),
            "PUT /api/tasks/[x]/locations": when("tasks.review", "const canVerify = can('tasks.review') && task.status === 'PENDING_CONFIRMATION'"),
            "PUT /api/tasks/[x]/details": when("tasks.edit", "const editable = !isRestricted && ['PENDING', 'IN_PROGRESS'].includes(task.status) && mayManage('tasks.edit')"),
            "DELETE /api/tasks/[x]/delete": when("tasks.delete", "...(!isRestricted && mayManage('tasks.delete') && !hasPaidCosts"),
            "GET /api/tasks/[x]/transfer": when("tasks.transfer", "const canTransfer = can('tasks.transfer')", "const transferable = !isRestricted && canTransfer && ['IN_PROGRESS', 'PENDING'].includes(task.status)"),
            "POST /api/tasks/[x]/transfer": when("tasks.transfer", "const canTransfer = can('tasks.transfer')", "const transferable = !isRestricted && canTransfer && ['IN_PROGRESS', 'PENDING'].includes(task.status)",
                "{deleted.length > 0 && canTransfer && !DECIDED.includes(task.status) && ("),
            // Paid or not, the whole task's for the company's payer, each person's share for whoever pays.
            "PUT /api/tasks/[x]/payment": when("tasks.pay", "...(owesCosts && companyWide('tasks.pay') && (task.paymentStatus === 'PAID' || task.paymentStatus === 'PENDING_PAYMENT')",
                "const settlements = can('tasks.pay') && isReviewed(task.status) && shared && Object.keys(getMemberCosts(task)).length > 0"),
            "POST /api/tasks/[x]/penalty": when("tasks.penalize", "const mayPenalise = features.has('SALARY_ADJUSTMENTS') && can('tasks.penalize') && !['PENDING', 'IN_PROGRESS'].includes(task.status)"),
            "POST /api/tasks/[x]/revert": superAdmin("...(userRole === 'SUPER_ADMIN' && ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(task.status) && task.paymentStatus === 'PENDING_PAYMENT'"),
            // Its place, when its details are edited.
            "GET /api/clients": when("clients.view", ...TASK_PLACE_CLIENTS),
            "GET /api/locations": when("locations.view", TASK_PLACE_LOCATIONS),
            "POST /api/locations": when("locations.create", TASK_PLACE_NEW),
            "PUT /api/locations": TASK_PLACE_NO_EDIT,
            "GET /api/companies": superAdmin(LOCATION_COMPANY),
            "GET /api/lists": ANYONE,
            "POST /api/lists": when("lists.add", LIST_ADD),
            "POST /api/upload": ANYONE,
            "GET /api/realtime/token": ANYONE,
        },
    },
    // The obligation, record and document screens, and the two tax pages that ask nothing (PR 388).
    "obligations": {
        // Everyone's, as Tasks is: their own, and their team's or the company's with See obligations.
        opens: ANYONE,
        asks: {
            "GET /api/users": when("employees.view", "const asks = on && can('employees.view')"),
            // The client filter (LATER_CHANGES_PLAN.md §7.7, 7a); an obligation has no location, so its filter's list isn't asked for.
            "GET /api/clients": when("clients.view", ...PLACE_FILTERS),
            "GET /api/locations": notHere("const clientFilter = usePlaceFilters({ clientId: filters.clientId })", { in: "components/locations/usePlaceFilters.ts", code: "const placed = picked.locationId !== undefined" }),
        },
    },
    "obligations/[id]": {
        opens: ANYONE,
        asks: {
            // Moving it along is its assignees'; editing, handing it on and deciding it each need their own
            // permission, decided change by change by the server (lib/services/obligation.service.ts).
            "PUT /api/obligations/[x]": ANYONE,
            "DELETE /api/obligations/[x]": { when: ["obligations.delete"], routeChecks: "lib/services/obligation.service.ts",
                gates: ["const mayDeleteThis = ownRule('obligations.delete')", "...(mayDeleteThis\n"] },
            // Who to hand it on to, when someone it was handed to is gone.
            "GET /api/assignees": { when: ["obligations.edit"], routeChecks: ASSIGNEES,
                gates: ["const canEdit = can('obligations.edit')", "{deleted.length > 0 && canEdit && !DECIDED.includes(obligation.status) && ("] },
            "POST /api/obligations/[x]/revert": superAdmin("...(userRole === 'SUPER_ADMIN' && ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(obligation.status)"),
            "POST /api/upload": ANYONE,
        },
    },
    "obligations/new": {
        opens: ["obligations.create"],
        asks: {
            "POST /api/obligations": { needs: ["obligations.create"], routeChecks: "lib/services/obligation.service.ts" },
            "GET /api/assignees": { needs: ["obligations.create"], routeChecks: ASSIGNEES },
            // Its client, for whoever may see clients (LATER_CHANGES_PLAN.md §7.7, 7a).
            "GET /api/clients": when("clients.view", "const seesClients = useCan().can('clients.view') && !(superAdmin && !selectedCompanyId)", "const clients = useClientOptions(mayCreate && seesClients)"),
        },
    },
    "records": {
        opens: ["records.view"],
        asks: {
            "GET /api/records": needs("records.view"),
            // A record's client's sections, in its form.
            "GET /api/records/sections": needs("records.view"),
            "POST /api/records": when("records.contribute", "adding={adding && can('records.contribute')}"),
            "PUT /api/records": when("records.contribute", "const canEdit = can('records.contribute')"),
            "DELETE /api/records": when("records.delete", "const canDelete = can('records.delete')"),
            // The client a new record is for, and the files of one not saved.
            "GET /api/records/clients": when("records.contribute", "adding={adding && can('records.contribute')}", "const clients = useClients(choosing)"),
            "DELETE /api/records/uploads": when("records.contribute", "adding={adding && can('records.contribute')}"),
            "POST /api/upload": ANYONE,
        },
    },
    "documents": {
        // One's own payslips: their route lets the person they're for, or whoever sees payroll.
        opens: ANYONE,
        asks: {
            "GET /api/users/[x]/payslips": ANYONE,
        },
    },
    "documents/payslip/[id]": {
        opens: ANYONE,
        asks: {
            "GET /api/payslips/[x]": ANYONE,
        },
    },
    "documents/settlement/[id]": {
        opens: ["settlements.view"],
        asks: {
            "GET /api/settlements/[x]": needs("settlements.view"),
            "POST /api/settlements/[x]/resend": when("settlements.resend", "const canSend = can('settlements.resend')", "{canSend && <Button busy={sending} onClick={resend}>"),
        },
    },
    // Drawn on the server, and a bookmark to run on the tax portal's own site: neither asks the server for anything.
    "clients/[id]/tax-statement": { opens: ["tax.view"], asks: {} },
    "tax-export": { opens: ["tax.manage"], asks: {} },
    // Requests (PR 389).
    "requests": {
        // Everyone's: what they asked for, and what waits on them.
        opens: ANYONE,
        asks: {
            // Asking, and withdrawing what one asked for.
            "POST /api/requests": ANYONE,
            "DELETE /api/requests/[x]": ANYONE,
            "POST /api/attendance/permissions": ANYONE,
            "GET /api/attendance/permissions/balance": ANYONE,
            "DELETE /api/attendance/permissions/[x]": ANYONE,
            "POST /api/attendance/missions": ANYONE,
            "GET /api/attendance/missions/tasks": ANYONE,
            "DELETE /api/attendance/missions/[x]": ANYONE,
            "POST /api/attendance/missing-punches": ANYONE,
            "DELETE /api/attendance/missing-punches/[x]": ANYONE,
            "POST /api/day-off-requests": when("dayoff.request", "const mayAskDayOff = !owner && sessionHasModule({ user: viewer }, 'DAY_OFF') && can(viewer, 'dayoff.request')"),
            // A role asked for, withdrawn by whoever asked, decided by whoever gives roles.
            "PUT /api/role-requests/[x]": { when: ["employees.assign_role", "employees.request_role"], routeChecks: "lib/services/role-request.service.ts",
                gates: [feed('mayDecide: waits && r.requestedById !== v.id && can(v, "employees.assign_role", target),'), feed('if (v.role === "SUPER_ADMIN" || !can(v, "employees.request_role")) return null')] },
            // Deciding, each kind for whoever decides it.
            "PATCH /api/requests/[x]": { when: ["requests.review"], routeChecks: "lib/services/request.service.ts",
                gates: [feed('const reaches = can(v, "requests.view", target) && can(v, "requests.review", target)')] },
            "PATCH /api/admin/day-off-requests/[x]": when("dayoff.approve", feed('const mayDecide = !decided && can(v, "dayoff.view", target) && can(v, "dayoff.approve", target)')),
            "POST /api/attendance/permissions/[x]/decide": when("attendance.approve_permissions", feed('mayDecide: waits && can(v, "attendance.approve_permissions", target),')),
            "POST /api/attendance/missions/[x]/decide": when("attendance.approve_missions", feed('const mayDecide = waits && can(v, "attendance.approve_missions", target)')),
            "POST /api/attendance/missions/[x]/cancel": when("attendance.approve_missions", feed('mayCancel: r.status === "APPROVED" && can(v, "attendance.approve_missions", target),')),
            "POST /api/attendance/missing-punches/[x]/decide": when("attendance.correct", feed('mayDecide: waits && can(v, "attendance.correct", target),')),
            "POST /api/attendance/flagged/[x]/decide": { when: ["attendance.correct"], routeChecks: "lib/attendance/punch-access.ts",
                gates: [feed('mayDecide: waits && can(v, "attendance.correct", target),')] },
            "GET /api/attendance/flagged/[x]/face": when("attendance.approve_face", feed('mayViewFace: waits && p.flagReasons.includes("FACE_UNVERIFIED") && can(v, "attendance.approve_face", target),')),
            "POST /api/attendance/overtime": when("attendance.approve_overtime", feed('mayDecide: can(v, "attendance.approve_overtime", target),')),
            "DELETE /api/attendance/overtime/[x]": when("attendance.approve_overtime", feed('mayWithdraw: can(v, "attendance.approve_overtime", target),')),
            "POST /api/attendance/phones/[x]/decide": { when: ["attendance.approve_devices"], routeChecks: "lib/attendance/phone-access.ts",
                gates: [feed('const decides = can(v, "attendance.approve_devices", target)'), feed("mayDecide: waits && decides,")] },
            "POST /api/attendance/phones/[x]/revoke": { when: ["attendance.approve_devices"], routeChecks: "lib/attendance/phone-access.ts",
                gates: [feed('const decides = can(v, "attendance.approve_devices", target)'), feed('mayRevoke: p.status === "ACTIVE" && decides,')] },
            "POST /api/profile-requests/[x]/[x]": { when: ["profile_requests.review"], routeChecks: "lib/services/profile.service.ts",
                gates: [feed('mayDecide: waits && can(v, "profile_requests.review", target),')] },
            // The attendance kinds' table joined to an ending another kind has: overtime is decided at its own path, and a
            // phone or a flagged check-in can't be withdrawn.
            "POST /api/attendance/overtime/[x]/decide": notHere("? await fetch(ATTENDANCE_API.overtime, {"),
            "DELETE /api/attendance/phones/[x]": notHere(feed("mayDecide: waits && decides,\n        mayDelete: false,\n        mayWithdraw: false,\n        mayRevoke")),
            "DELETE /api/attendance/flagged/[x]": notHere(feed('mayDecide: waits && can(v, "attendance.correct", target),\n        mayDelete: false,\n        mayWithdraw: false,\n        flagged: {')),
            "GET /api/users": when("employees.view", "const asks = on && can('employees.view')"),
            "GET /api/realtime/token": ANYONE,
        },
    },
    // The people screens (PR 390).
    "employees/[id]": {
        // One's own profile (the header's My profile), and someone else's with See employees, as the users route checks.
        opens: ANYONE,
        asks: {
            // Theirs, read and saved: one's own, or another's with See and Edit employees, decided field by field by the server.
            "GET /api/users": ANYONE,
            "PUT /api/users": ANYONE,
            "POST /api/auth/verify": ANYONE,
            // One's own name change, asked for and waiting.
            "GET /api/profile-requests": ANYONE,
            "POST /api/profile-requests": ANYONE,
            // A name's other language, suggested as it's typed, where the form keeps both (PR 403).
            "GET /api/names/suggest": ANYONE,
            "POST /api/users/[x]/reset-password": when("employees.reset_password", profile("resetPassword: can('employees.reset_password') && !own && actsOnThem,")),
            "GET /api/users/[x]/employment": when("employees.end_contract", profile("endContract: can('employees.end_contract') && !own && actsOnThem && person.role !== 'SUPER_ADMIN',")),
            "POST /api/users/[x]/employment": when("employees.end_contract", profile("endContract: can('employees.end_contract') && !own && actsOnThem && person.role !== 'SUPER_ADMIN',")),
            // When their contract started, changed with its own permission (LATER_CHANGES_PLAN.md §7.2, PR 425).
            "POST /api/users/[x]/contract-start": when("employees.edit_contract_start", profile("changeContractStart: can('employees.edit_contract_start') && !own && actsOnThem && person.role !== 'SUPER_ADMIN' && person.role !== '',")),
            // Adding them to the owners, or removing them (PR 426).
            "POST /api/users/[x]/owner": when("employees.set_owner", profile("setOwner: can('employees.set_owner') && !own && (superAdmin || viewer?.role === 'ADMIN') && person.role !== 'SUPER_ADMIN' && person.role !== '',")),
            // Their role: given by whoever gives roles, asked for by whoever may only ask.
            "GET /api/roles/assignable": when(["employees.assign_role", "employees.request_role"], "const picksRole = !!access.changeRole && (!seeing || access.changeRole === 'ask')",
                profile(": can('employees.assign_role') ? 'assign'"), ASKS_ROLE),
            "GET /api/role-requests": when("employees.request_role", "useSWR(access.changeRole === 'ask' ? `/api/role-requests?userId=", ASKS_ROLE),
            "POST /api/role-requests": when("employees.request_role", ASKS_ROLE),
            "GET /api/companies": superAdmin("if (userRole === 'SUPER_ADMIN') {", "fetchCompanies()"),
            // What's taken from their pay (LATER_CHANGES_PLAN.md §7.12, step 9b, PR 442): read wherever their salary is
            // shown, one's own too, as the route checks; saved by whoever may change their salary.
            "GET /api/users/[x]/payroll-deductions": ANYONE,
            "PUT /api/users/[x]/payroll-deductions": when("salary.edit", profile("changeSalary: can('salary.edit') && !own && paid && payroll,"), "change={access.changeSalary}"),
        },
    },
    "cash-advances/[userId]": {
        // Someone's cash advance, from Costs; one's own is cash-advances/mine.
        opens: ["cash_advances.view"],
        asks: {
            "GET /api/cash-advances/[x]": { needs: ["cash_advances.view"], routeChecks: "lib/services/cash-advance.service.ts" },
            // Giving and moving, for whoever gives, as the server says.
            "POST /api/cash-advances/[x]": when("cash_advances.give", "const giving = advance.canGive && (", { in: "lib/services/cash-advance.service.ts", code: 'canGive: can(user, "cash_advances.give", target),' }),
            "GET /api/cash-advances/[x]/purposes": when("cash_advances.give", "const giving = advance.canGive && (", { in: "lib/services/cash-advance.service.ts", code: 'canGive: can(user, "cash_advances.give", target),' }),
            "POST /api/cash-advances/[x]/move": when("cash_advances.give", "const canMove = advance.canGive && !mine", { in: "lib/services/cash-advance.service.ts", code: 'canGive: can(user, "cash_advances.give", target),' }),
            // What they're owed, paid with what's given: the server says what's owed only to whoever pays.
            "POST /api/tasks/payment/bulk": when("tasks.pay", "const paying = owed && payOwed === 'yes' ? owed : null", { in: "lib/services/costs-query.ts", code: 'if (!can(user, "tasks.pay")) return null' }),
            // Confirming receipt is on one's own page alone.
            "POST /api/cash-advances/entries/[x]/confirm": notHere("const confirmButton = (e: AdvanceEntry) => mine && awaitingOf(e) && (", "return <CashAdvanceHistory userId={userId} />"),
            "POST /api/upload": ANYONE,
            "GET /api/realtime/token": ANYONE,
        },
    },
    "roles-and-access": {
        // A company's own: its role change requests, for whoever gives roles, and its access reviews, for whoever
        // answers them, each on its own tab (LATER_CHANGES_PLAN.md §7.15, PR 439). The Super Admin answers both
        // from their own pages.
        opens: ["employees.assign_role", "employees.review_access"],
        asks: {
            "GET /api/role-change-requests": { when: ["employees.assign_role"], gates: [CHANGES_TAB], routeChecks: "lib/services/role-change-request.service.ts" },
            "POST /api/role-change-requests": { when: ["employees.assign_role"], gates: [CHANGES_TAB], routeChecks: "lib/services/role-change-request.service.ts" },
            "GET /api/roles/assignable": when("employees.assign_role", CHANGES_TAB),
            "PUT /api/role-change-requests/[x]": { superAdmin: ["end={side === 'superAdmin' && r.status === 'OPEN' && ("], routeChecks: "lib/services/role-change-request.service.ts" },
            "GET /api/access-reviews": { when: ["employees.review_access"], gates: [REVIEWS_TAB], routeChecks: "lib/services/access-review.service.ts" },
            "PUT /api/access-reviews/lines/[x]": { when: ["employees.review_access"], gates: [REVIEWS_TAB], routeChecks: "lib/services/access-review.service.ts" },
        },
    },
    "": {
        // The home page: what it shows is read on the server, each part behind its own check; it asks the server for nothing.
        opens: ANYONE,
        asks: {},
    },
    "settings": {
        // The tabs the server shows: the Super Admin's switch and ticks with See settings, or the client portal's
        // with its own permission.
        opens: ["settings.view", "client_messages.manage"],
        asks: {
            "GET /api/company-settings": { needs: ["settings.view", "client_messages.manage"], routeChecks: [SETTINGS_ACCESS, "lib/company-settings-tabs.ts"] },
            // Whether settings show in the side bar, asked again once cash advances change.
            "GET /api/company-settings/visible": ANYONE,
            // General, branding and payroll: saved with Edit settings.
            "PUT /api/company-settings": { when: ["settings.edit"], routeChecks: SETTINGS_ACCESS, gates: EDITS },
            "POST /api/companies/logo": { when: ["settings.edit"], routeChecks: SETTINGS_ACCESS, gates: EDITS },
            "DELETE /api/companies/logo": { when: ["settings.edit"], routeChecks: SETTINGS_ACCESS, gates: EDITS },
            // Payroll deductions: read when the Payroll tab shows, saved with Edit settings (PR 440).
            "GET /api/company-deductions": { when: ["settings.view"], routeChecks: SETTINGS_ACCESS, gates: PAYROLL_TAB },
            "PUT /api/company-deductions": { when: ["settings.edit"], routeChecks: SETTINGS_ACCESS, gates: [...EDITS, ...PAYROLL_TAB] },
            // Salary advances' rules, the same way (LATER_CHANGES_PLAN.md §7.5, step 2).
            "GET /api/company-salary-advances": { when: ["settings.view"], routeChecks: SETTINGS_ACCESS, gates: PAYROLL_TAB },
            "PUT /api/company-salary-advances": { when: ["settings.edit"], routeChecks: SETTINGS_ACCESS, gates: [...EDITS, ...PAYROLL_TAB] },
            // Attendance: read when the tab shows, changed with Edit settings.
            "GET /api/attendance/calendar": reads,
            "GET /api/attendance/policy": reads,
            "GET /api/attendance/payroll-from": reads,
            "GET /api/attendance/face/legal": reads,
            "GET /api/attendance/locations": reads,
            "POST /api/attendance/schedules": edits(),
            "DELETE /api/attendance/schedules/[x]": edits(),
            "POST /api/attendance/schedules/[x]/versions": edits(),
            "DELETE /api/attendance/versions/[x]": edits(),
            "POST /api/attendance/schedules/[x]/default": edits(),
            "DELETE /api/attendance/defaults/[x]": edits(),
            "POST /api/attendance/schedules/[x]/overrides": edits(),
            "PUT /api/attendance/overrides/[x]": edits(),
            "DELETE /api/attendance/overrides/[x]": edits(),
            "POST /api/attendance/assignments": edits(),
            "DELETE /api/attendance/assignments/[x]": edits(),
            "POST /api/attendance/holidays": edits(),
            "DELETE /api/attendance/holidays/[x]": edits(),
            "PUT /api/attendance/holidays/apply": edits(),
            "DELETE /api/attendance/holidays/apply/[x]": edits(),
            "PUT /api/attendance/holidays/observed": edits(),
            "POST /api/attendance/policy": edits(),
            "DELETE /api/attendance/policy/[x]": edits(),
            // A policy tried before it's saved; See salaries only decides whether the day rates show.
            "POST /api/attendance/policy/simulate": edits(),
            "PUT /api/attendance/payroll-from": edits(),
            "PUT /api/attendance/face/legal": edits(),
            "POST /api/attendance/locations": edits(),
            "PATCH /api/attendance/locations/[x]": edits(),
            "DELETE /api/attendance/locations/[x]": edits(),
            "POST /api/attendance/locations/[x]/restore": edits(),
            "PUT /api/attendance/locations/[x]/people": edits(),
            // Fingerprint terminals, for whoever manages them where the company sets its own up.
            "GET /api/attendance/devices": terminals,
            "POST /api/attendance/devices": terminals,
            "PATCH /api/attendance/devices/[x]": terminals,
            "DELETE /api/attendance/devices/[x]": terminals,
            "POST /api/attendance/devices/[x]/restore": terminals,
            "POST /api/attendance/devices/[x]/address": terminals,
            "PUT /api/attendance/devices/[x]/connection": terminals,
            "PUT /api/attendance/devices/[x]/office-address": terminals,
            "GET /api/attendance/agents": terminals,
            "POST /api/attendance/agents": terminals,
            "DELETE /api/attendance/agents/[x]": terminals,
            "POST /api/attendance/agents/[x]/code": terminals,
            // What a terminal sent first, for the Super Admin, who never opens this page.
            "GET /api/attendance/devices/[x]/first-contacts": notHere("if (superAdmin || refused) return <AccessDenied />",
                "const contactsItem = (d: Device): MenuItem[] => (superAdmin && keepsFirstContacts(d)"),
            // The client portal: the company's own messages, and who's emailed.
            "GET /api/company-messages": portal,
            "DELETE /api/company-messages/[x]": portal,
            "GET /api/company-messages/emails": portal,
            "PUT /api/company-messages/emails": portal,
            // The Super Admin's tabs: roles, modules, and which tabs the company sees.
            "GET /api/roles": SUPER_ADMINS_TAB,
            "POST /api/roles": SUPER_ADMINS_TAB,
            "PUT /api/roles": SUPER_ADMINS_TAB,
            "DELETE /api/roles": SUPER_ADMINS_TAB,
            "PUT /api/roles/default": SUPER_ADMINS_TAB,
            "GET /api/roles/export": SUPER_ADMINS_TAB,
            "GET /api/role-templates": SUPER_ADMINS_TAB,
            "POST /api/roles/copy": SUPER_ADMINS_TAB,
            "GET /api/companies": SUPER_ADMINS_TAB,
            "PUT /api/access-reviews/settings": SUPER_ADMINS_TAB,
            "PUT /api/companies": SUPER_ADMINS_TAB,
        },
    },
    "settings/client-messages/[kind]": {
        // One of the company's client messages, from the client portal tab.
        opens: ["client_messages.manage"],
        asks: {
            "GET /api/company-messages": needs("client_messages.manage"),
            // Saved through the save path the page hands the editor (PR 395).
            "PUT /api/company-messages/[x]/[x]": needs("client_messages.manage"),
        },
    },
    "settings/terminal-guide": {
        // How to set a terminal up, from the terminals panel.
        opens: ["attendance.manage_terminals"],
        asks: {
            "GET /api/attendance/devices": { needs: ["attendance.manage_terminals"], routeChecks: TERMINALS },
        },
    },
    "check-in": {
        // Everyone's, from their own phone; the Super Admin has none (lib/side-bar.ts), and the routes refuse them.
        opens: ANYONE,
        asks: {
            // One's own phone and face check, and their consent to it.
            "GET /api/attendance/phone": ANYONE,
            "GET /api/attendance/face": ANYONE,
            "POST /api/attendance/face/consent": ANYONE,
            "DELETE /api/attendance/face/consent": ANYONE,
            // Sent from lib/mobile through the sender the screen gives it: the phone registered, a check-in, the face
            // check's key and photos, and where to send notices.
            "POST /api/attendance/phone/challenge": ANYONE,
            "POST /api/attendance/phone/register": ANYONE,
            "POST /api/attendance/check-in": ANYONE,
            "POST /api/attendance/face/key": ANYONE,
            "POST /api/attendance/face/key/ack": ANYONE,
            "POST /api/attendance/face/photo": ANYONE,
            "POST /api/attendance/phone/push-token": ANYONE,
            // Late: a permission asked for, with the hours left.
            "GET /api/attendance/permissions/balance": ANYONE,
            "POST /api/attendance/permissions": ANYONE,
            // The rest of the Requests tab: one's phone withdrawn, a missing punch, and overtime approved ahead.
            "DELETE /api/attendance/phone": LATE_ASKING,
            "POST /api/attendance/missing-punches": LATE_ASKING,
            "GET /api/attendance/people": LATE_ASKING,
            "POST /api/attendance/overtime": LATE_ASKING,
            "GET /api/attendance/missions/tasks": ASKING_DIALOGS,
            "POST /api/attendance/missions": ASKING_DIALOGS,
            "DELETE /api/attendance/permissions/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/missions/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/missing-punches/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/overtime/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/phones/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/flagged/[x]": ASKING_DIALOGS,
            "POST /api/attendance/permissions/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/missions/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/missions/[x]/cancel": ASKING_DIALOGS,
            "POST /api/attendance/missing-punches/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/overtime/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/flagged/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/phones/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/phones/[x]/revoke": ASKING_DIALOGS,
            "POST /api/profile-requests/[x]/[x]": ASKING_DIALOGS,
            "PUT /api/role-requests/[x]": ASKING_DIALOGS,
        },
    },
    "attendance": {
        // Everyone's: one's own days and punches, and, with See team attendance, other people's at its scope.
        opens: ANYONE,
        asks: {
            "GET /api/attendance/people": ANYONE,
            "GET /api/attendance/days": ANYONE,
            "GET /api/attendance/punches": ANYONE,
            // One's own: the permission hours left, asking for one, a missing punch reported, and the phone one checks in from.
            "GET /api/attendance/permissions/balance": ANYONE,
            "POST /api/attendance/permissions": ANYONE,
            "POST /api/attendance/missing-punches": ANYONE,
            "GET /api/attendance/phone": ANYONE,
            "DELETE /api/attendance/phone": ANYONE,
            "GET /api/realtime/token": ANYONE,
            // What needs a decision, for whoever sees other people's.
            "GET /api/attendance/exceptions": { when: ["attendance.view_team"], routeChecks: PUNCH_ACCESS,
                gates: ["const seesOthers = p.can('attendance.view_team')", "{tab === 'exceptions' && today && seesOthers && <ExceptionsTab"] },
            // Correcting: a punch added or withdrawn, a day decided or its decision undone, for each person the role reaches.
            "POST /api/attendance/punches": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS,
                gates: ["action={p.can('attendance.correct') ? <Button variant=\"primary\" size=\"sm\" onClick={() => setAdding(true)}", CORRECTS_ROW, "const settle = (r: Row) => (corrects(r) ? ("] },
            "POST /api/attendance/punches/[x]/void": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS,
                gates: ["? p.canFor('attendance.correct', punch.userId, leaderOf.get(punch.userId) ?? null)", "const mayWithdraw = (punch: Punch) => mayCorrect(punch) && punch.userId !== me", "const withdrawButton = (x: Punch) => (mayWithdraw(x) ?"] },
            "POST /api/attendance/decisions": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS,
                gates: [CORRECTS_ROW, "const decisionButtons = (row: Row, subject: Subject) => corrects(row) ? (", "const settle = (r: Row) => (corrects(r) ? ("] },
            "DELETE /api/attendance/decisions/[x]": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS, gates: [CORRECTS_ROW, "const undo = (d: Decided) => (corrects(d) ? ("] },
            // Overtime decided, or approved ahead.
            "POST /api/attendance/overtime": when("attendance.approve_overtime",
                "const approvesOvertime = (row: Row) => row.userId !== me && p.canFor('attendance.approve_overtime', row.userId, row.teamLeaderId)",
                "const decideOvertime = (r: Row) => (approvesOvertime(r) ? (", "const decidesOvertime = p.can('attendance.approve_overtime')", "{decidesOvertime && ("),
            // The company's: its month worked out again, its files imported, and who each terminal number is.
            "POST /api/attendance/recompute": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS,
                gates: [CORRECTS_COMPANY, "action={correctsCompany ? <Button size=\"sm\" onClick={() => { void recompute() }}"] },
            "GET /api/attendance/imports": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS, gates: [CORRECTS_COMPANY, "{tab === 'import' && correctsCompany && <ImportTab"] },
            "POST /api/attendance/imports": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS, gates: [CORRECTS_COMPANY, "{tab === 'import' && correctsCompany && <ImportTab"] },
            "POST /api/attendance/imports/[x]/void": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS, gates: [CORRECTS_COMPANY, "{tab === 'import' && correctsCompany && <ImportTab"] },
            "GET /api/attendance/import-template": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS, gates: [CORRECTS_COMPANY, "{tab === 'import' && correctsCompany && <ImportTab"] },
            "GET /api/attendance/codes": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS, gates: [CORRECTS_COMPANY, "{tab === 'numbers' && correctsCompany && <NumbersTab"] },
            "POST /api/attendance/codes": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS, gates: [CORRECTS_COMPANY, "{tab === 'numbers' && correctsCompany && <NumbersTab"] },
            "DELETE /api/attendance/codes/[x]": { when: ["attendance.correct"], routeChecks: PUNCH_ACCESS, gates: [CORRECTS_COMPANY, "{tab === 'numbers' && correctsCompany && <NumbersTab"] },
            // Face verification, for whoever decides it company-wide.
            "GET /api/attendance/face/people": when("attendance.approve_face", ...FACE_TAB),
            "PUT /api/attendance/face/people": when("attendance.approve_face", ...FACE_TAB),
            "POST /api/attendance/face/reverify": when("attendance.approve_face", ...FACE_TAB),
            "GET /api/attendance/face/reviews": { when: ["attendance.approve_face"], gates: FACE_TAB, routeChecks: "lib/attendance/face-access.ts" },
            "POST /api/attendance/face/reviews/[x]/decide": { when: ["attendance.approve_face"], gates: FACE_TAB, routeChecks: "lib/attendance/face-access.ts" },
            "GET /api/attendance/face/reviews/[x]/photo": { when: ["attendance.approve_face"], gates: FACE_TAB, routeChecks: "lib/attendance/face-access.ts" },
            // A flagged check-in's photos are Requests' dialog; the face tab takes only the photo frame.
            "GET /api/attendance/flagged/[x]/face": notHere("import { FacePhoto as Photo, useWatermark } from '@/components/FacePhoto'"),
            "GET /api/attendance/missions/tasks": ASKING_DIALOGS,
            "POST /api/attendance/missions": ASKING_DIALOGS,
            "DELETE /api/attendance/permissions/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/missions/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/missing-punches/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/overtime/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/phones/[x]": ASKING_DIALOGS,
            "DELETE /api/attendance/flagged/[x]": ASKING_DIALOGS,
            "POST /api/attendance/permissions/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/missions/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/missions/[x]/cancel": ASKING_DIALOGS,
            "POST /api/attendance/missing-punches/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/overtime/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/flagged/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/phones/[x]/decide": ASKING_DIALOGS,
            "POST /api/attendance/phones/[x]/revoke": ASKING_DIALOGS,
            "POST /api/profile-requests/[x]/[x]": ASKING_DIALOGS,
            "PUT /api/role-requests/[x]": ASKING_DIALOGS,
        },
    },
    "tasks/new": {
        opens: ["tasks.create"],
        asks: {
            "POST /api/tasks": needs("tasks.create"),
            // The spreadsheet to fill in, and its places, which an upload checks its rows against: See locations, which adding a task needs first (§5.3).
            "GET /api/templates/download": needs("tasks.create"),
            "GET /api/assignees": { needs: ["tasks.create"], routeChecks: ASSIGNEES },
            "GET /api/locations": needs("locations.view"),
            "GET /api/clients": when("clients.view", "const canUseClients = useCan().can('clients.view')", ...TASK_PLACE_CLIENTS),
            "POST /api/locations": when("locations.create", TASK_PLACE_NEW),
            "PUT /api/locations": TASK_PLACE_NO_EDIT,
            // The Super Admin manages the templates instead of downloading one.
            "GET /api/templates/status": superAdmin("{userRole === 'SUPER_ADMIN'", "const allCompanies = isOpen && !selectedCompanyId"),
            // The template there now, for the Super Admin managing them (lib/bulk-templates.ts, found since PR 394).
            "GET /api/templates/raw": superAdmin("{userRole === 'SUPER_ADMIN'", "? <Button icon={FileXlsIcon} onClick={() => setIsManageTemplatesOpen(true)}>{t('manage_templates')}</Button>"),
            "GET /api/companies": superAdmin(LOCATION_COMPANY),
            "GET /api/lists": ANYONE,
            "POST /api/lists": when("lists.add", LIST_ADD),
        },
    },
    "locations": {
        opens: ["locations.view"],
        asks: {
            "GET /api/locations": needs("locations.view"),
            "POST /api/locations": when("locations.create", "adding={adding && can('locations.create')}"),
            "PUT /api/locations": when(["locations.edit", "locations.archive"], ...LOCATION_CHANGE),
            // The client a place is for, and the list's client filter.
            "GET /api/clients": when("clients.view", ...CLIENT_PICKERS),
            "GET /api/companies": superAdmin(LOCATION_COMPANY),
        },
    },
    "lists": {
        // Each part of what was Manage lists (PR 379).
        opens: ["lists.rename", "lists.merge", "lists.archive"],
        asks: {
            // Renaming, merging and archiving are this screen's whole job.
            "GET /api/lists": ANYONE,
            "PUT /api/lists": needs("lists.rename", "lists.merge", "lists.archive"),
            // Adding, which none of them includes.
            "POST /api/lists": when("lists.add", "<SavedLists adding={adding && can('lists.add')}", "action={can('lists.add') && <Button variant=\"primary\" icon={PlusIcon} onClick={() => setAdding(true)}>"),
        },
    },
    "costs": {
        // Its tabs: Employee costs, Charged to clients and Cash advances (lib/side-bar.ts).
        opens: ["tasks.pay", "charges.view", "cash_advances.view"],
        asks: {
            // Paying, from Employee costs, or with an advance given, where the server says what's owed only to whoever pays.
            "POST /api/tasks/payment/bulk": when("tasks.pay", "const pays = can(session.user as any, 'tasks.pay')",
                { in: "lib/services/costs-query.ts", code: 'if (!can(user, "tasks.pay")) return null' }),
            "GET /api/charges": when("charges.view", "const seesCharges = can(session.user as any, 'charges.view')"),
            "PATCH /api/charges/[x]": when("charges.set", ...CHARGE_FEE),
            "POST /api/charges/collect": when("charges.collect", ...CHARGE_COLLECT),
            "POST /api/charges/[x]/uncollect": when("charges.collect", ...CHARGE_UNCOLLECT),
            "GET /api/cash-advances": when("cash_advances.view", "const seesAdvances = can(session.user as any, 'cash_advances.view')"),
            // A person's advance, as it is, for the one giving it: answered for whoever sees advances, which giving brings.
            "GET /api/cash-advances/[x]": { when: ["cash_advances.give"], gates: ["const mayGive = (h: AdvanceHolder) => can('cash_advances.give') && h.id !== viewer?.id"],
                answers: ["cash_advances.view"], routeChecks: "lib/services/cash-advance.service.ts" },
            "POST /api/cash-advances/[x]": when("cash_advances.give", "const mayGive = (h: AdvanceHolder) => can('cash_advances.give') && h.id !== viewer?.id"),
            "GET /api/cash-advances/[x]/purposes": when("cash_advances.give", "const mayGive = (h: AdvanceHolder) => can('cash_advances.give') && h.id !== viewer?.id"),
            // The filters: a client, a place, a person, a cost's name.
            "GET /api/clients": when("clients.view", "useClientOptions(can('clients.view') && !onPage, true)", ...PLACE_FILTERS),
            "GET /api/locations": when("locations.view", ...PLACE_FILTERS),
            "GET /api/users": when("employees.view", "const asks = on && can('employees.view')"),
            "GET /api/lists": ANYONE,
            "POST /api/upload": ANYONE,
            "GET /api/realtime/token": ANYONE,
        },
    },
    "clients": {
        opens: ["clients.view"],
        asks: {
            "GET /api/clients": needs("clients.view"),
            "POST /api/clients": when("clients.create", "const mayAdd = can('clients.create')", "action={mayAdd && <Button"),
            // Editing, and restoring from the archive.
            "PUT /api/clients": when(["clients.edit", "clients.delete"], "const mayEdit = can('clients.edit')", "...(mayEdit ? [{ key: 'edit'",
                "const mayDelete = can('clients.delete')", "...(c.archivedAt ? (!mayDelete ? [] : ["),
            "DELETE /api/clients": when("clients.delete", "const mayDelete = can('clients.delete')", "...(!mayDelete ? [] : [archivesInstead(c)"),
            "GET /api/companies": superAdmin("const everyCompany = superAdmin && !selectedCompanyId", "pickCompany={everyCompany}"),
            // A name's other language, suggested as it's typed, in the dialog that adds or edits one (PR 406).
            "GET /api/names/suggest": ANYONE,
        },
    },
    "clients/[id]": {
        // Its tabs, each for whoever sees it: details, records, places, charges, tax, client portal.
        opens: ["clients.view", "records.view", "charges.view"],
        asks: {
            "GET /api/clients": when("clients.view", "const seesClient = can('clients.view')", "(seesClient ? `/api/clients?id="),
            "PUT /api/clients": when("clients.delete", "? can('clients.delete') && <Button variant=\"primary\" icon={ArrowCounterClockwiseIcon}"),
            "GET /api/clients/accountant": when("clients.edit", "picks={can('clients.edit')}", "if (picks && !archived) return <AccountantPicker"),
            "PUT /api/clients/accountant": when("clients.edit", "picks={can('clients.edit')}", "if (picks && !archived) return <AccountantPicker"),
            // Who signs in for it (lib/client-people.ts, found since PR 394).
            "GET /api/client-accounts": when("client_accounts.view", "const seesPeople = features.has('TAX_POSITION') && can('client_accounts.view')", "{seesPeople && <ClientPeople"),
            "GET /api/records": when("records.view", "const seesRecords = can('records.view')", "{seesRecords && !sectionsFailed && ("),
            "POST /api/records": when("records.contribute", "adding={!archived && adding && can('records.contribute')}"),
            "PUT /api/records": when("records.contribute", "const canEdit = can('records.contribute')", "...(canEdit ? [{ key: 'edit'"),
            "DELETE /api/records": when("records.delete", "const canDelete = can('records.delete')", "...(canDelete ? [{ key: 'delete', label: t('records_delete')"),
            "GET /api/records/sections": when("records.view", "const seesRecords = can('records.view')", "seesRecords ? `/api/records/sections?clientId="),
            "POST /api/records/sections": when("records.contribute", "const canAdd = can('records.contribute') && !archived", "action={canAdd && <Button icon={FolderPlusIcon}"),
            "PUT /api/records/sections": when("records.edit", "const canRename = can('records.edit')", "...(canRename ? [{ key: 'rename'"),
            "DELETE /api/records/sections": when("records.delete", "const canDelete = can('records.delete')", "...(canDelete ? [{ key: 'delete', label: t('records_delete_section')"),
            // A record's form, open only to add or change one; its client is this one, not chosen.
            "GET /api/records/clients": when("records.contribute", "adding={!archived && adding && can('records.contribute')}", "const clients = useClients(choosing)"),
            "DELETE /api/records/uploads": when("records.contribute", "adding={!archived && adding && can('records.contribute')}"),
            "GET /api/locations": when("locations.view", "const seesLocations = can('locations.view')", "{seesLocations && ("),
            "POST /api/locations": when("locations.create", "adding={!archived && addingLocation && can('locations.create')}"),
            "PUT /api/locations": when(["locations.edit", "locations.archive"], ...LOCATION_CHANGE),
            "GET /api/charges": when("charges.view", "const seesCharges = can('charges.view')", "{seesCharges && <ChargesList client={{ id, name }} />}"),
            "PATCH /api/charges/[x]": when("charges.set", ...CHARGE_FEE),
            "POST /api/charges/collect": when("charges.collect", ...CHARGE_COLLECT),
            "POST /api/charges/[x]/uncollect": when("charges.collect", ...CHARGE_UNCOLLECT),
            "GET /api/tax-claims": when("tax.view", "const seesTax = features.has('TAX_POSITION') && can('tax.view')", "{seesTax && <TaxPosition"),
            "POST /api/client-accounts": when("client_accounts.invite", "const seesPeople = features.has('TAX_POSITION') && can('client_accounts.view')", "{seesPeople && <ClientPeople", PEOPLE_MAY),
            "DELETE /api/client-accounts/[x]": when("client_accounts.remove", "const seesPeople = features.has('TAX_POSITION') && can('client_accounts.view')", "{seesPeople && <ClientPeople", PEOPLE_MAY),
            "POST /api/client-accounts/[x]/invitation": when("client_accounts.invite", "const seesPeople = features.has('TAX_POSITION') && can('client_accounts.view')", "{seesPeople && <ClientPeople", PEOPLE_MAY),
            "GET /api/companies": superAdmin(LOCATION_COMPANY),
            "POST /api/upload": ANYONE,
            "GET /api/realtime/token": ANYONE,
        },
    },
    "clients/[id]/statement": {
        opens: ["charges.view"],
        asks: {
            "GET /api/charges/statement": needs("charges.view"),
        },
    },
    "employees": {
        opens: ["employees.view"],
        asks: {
            "GET /api/users": needs("employees.view"),
            "DELETE /api/users": when("employees.delete", "if (can('employees.delete') && e.role !== 'SUPER_ADMIN') {"),
            // Suspending and reactivating, from here, are the Super Admin's.
            "PUT /api/users": { superAdmin: ["if (isSuperAdmin && e.status !== 'ARCHIVED') {"], routeChecks: "lib/services/user.service.ts" },
            "PATCH /api/users/team": when("employees.assign_team", "const canAssignTeams = can('employees.assign_team')", "{canAssignTeams && picked.size > 0 && ("),
            "POST /api/users/[x]/reset-points": { when: ["requests.reset_points"], gates: ["if (can('requests.reset_points') && notAdmin) {"], routeChecks: "lib/services/user.service.ts" },
            // The list says who is locked out only to whoever may unlock (components/SignInLock.tsx).
            "POST /api/users/[x]/unlock-sign-in": when("employees.reset_password",
                { in: "app/api/users/route.ts", code: 'const locks = can(session.user, "employees.reset_password") ? await lockedUntil(' }),
            "GET /api/realtime/token": ANYONE,
        },
    },
    // The company's owners (LATER_CHANGES_PLAN.md §7.3, step 3c, PR 429), for whoever sees the whole company's people.
    "owners": {
        opens: ["employees.view"],
        asks: {
            "GET /api/users": needs("employees.view"),
            // Taking one off, as on their details: by an Admin or the Super Admin (PR 428).
            "POST /api/users/[x]/owner": when("employees.set_owner", "const canRemove = (e: Owner) => !own(e) && can('employees.set_owner') && (isSuperAdmin || userRole === 'ADMIN')"),
            // Who is locked out, as on Employees (components/SignInLock.tsx).
            "POST /api/users/[x]/unlock-sign-in": when("employees.reset_password",
                { in: "app/api/users/route.ts", code: 'const locks = can(session.user, "employees.reset_password") ? await lockedUntil(' }),
            "GET /api/realtime/token": ANYONE,
        },
    },
    "employees/new": {
        opens: ["employees.create"],
        asks: {
            "POST /api/users": needs("employees.create"),
            // The team leaders to put the person under.
            "GET /api/users": { when: ["employees.assign_team"], answers: ["employees.view"],
                gates: ["const canAssignTeam = can('employees.assign_team')", "mayCreate && canAssignTeam ? '/api/users?role=TEAM_LEADER"] },
            "GET /api/roles/assignable": when(["employees.assign_role", "employees.request_role"], "const canAssignRole = can('employees.assign_role')",
                "const canRequestRole = !canAssignRole && can('employees.request_role')", "{(canAssignRole || canRequestRole) && ("),
            "GET /api/companies": superAdmin("mayCreate && isSuperAdmin ? '/api/companies"),
            // The name's other language, suggested as it's typed (PR 402): anyone's, as one's own profile takes a name.
            "GET /api/names/suggest": ANYONE,
            // Today in the company's calendar, for the contract start date (review on PR 425): anyone's to ask.
            "GET /api/time": ANYONE,
        },
    },
    "employees/[id]/bonus": {
        opens: ["salary_adjustments.add"],
        asks: {
            // Whose pay it is, by name: See employees, which adding one needs first (§5.3).
            "GET /api/users": needs("employees.view"),
            "POST /api/users/[x]/[x]": { needs: ["salary_adjustments.add"], routes: ["users/[id]/bonus", "users/[id]/deduction"] },
        },
    },
    "employees/[id]/deduction": {
        opens: ["salary_adjustments.add"],
        asks: {
            "GET /api/users": needs("employees.view"),
            "POST /api/users/[x]/[x]": { needs: ["salary_adjustments.add"], routes: ["users/[id]/bonus", "users/[id]/deduction"] },
        },
    },
    "payroll": {
        opens: ["payroll.view"],
        asks: {
            "GET /api/payroll/[x]/[x]": needs("payroll.view"),
            "GET /api/payroll/[x]/[x]/export": needs("payroll.view"),
            "GET /api/attendance/discrepancies": needs("payroll.view"),
            "POST /api/payroll/[x]/[x]": when("payroll.prepare", "const canPrepare = can('payroll.prepare')", "{canPrepare && (\n                            <Button onClick={() => action.run('save', save)}"),
            // A draft's days worked out again (PR 425): the draft's to prepare, where the company has attendance.
            "POST /api/payroll/[x]/[x]/recalculate": when("payroll.prepare", "const canPrepare = can('payroll.prepare')", "const canRecalculate = isDraft && canPrepare && features.has('ATTENDANCE')", "{canRecalculate && (\n                            <Button onClick={() => action.run('recalculate', recalculate)}"),
            "POST /api/payroll/[x]/[x]/approve": when("payroll.approve", "const canApprove = can('payroll.approve')", "{canApprove && (view?.periodOver === false && view.approvableFrom ? (", "<Button variant=\"primary\" onClick={openApprove}"),
            // Change this month's payday (LATER_CHANGES_PLAN.md §7.10, PR 430), until it's paid.
            "PUT /api/payroll/[x]/[x]/payday": when("payroll.approve", "const canApprove = can('payroll.approve')", "{canApprove && view.status !== 'PAID' && view.period && ("),
            "POST /api/payroll/[x]/[x]/issue": when("payroll.issue_payslips", "const canIssue = can('payroll.issue_payslips')", ") : canIssue && ("),
            "POST /api/payroll/[x]/[x]/paid": when("payroll.mark_paid", "const canMarkPaid = can('payroll.mark_paid')", ") : canMarkPaid ? ("),
            "POST /api/attendance/discrepancies/[x]/resolve": when("payroll.prepare", "const canPrepare = can('payroll.prepare')", "{canPrepare && <Button size=\"sm\" aria-label={t('attpay_resolve_for')"),
            "POST /api/debts/[x]/waive": when("debts.waive", "const canWaive = can('debts.waive')", "{canWaive && ("),
        },
    },
}


/** A page that only sends you on to another, which is in the table (PR 387). */
const SENDS_ON = "sends you on"

/** Not a permission's screen: the Super Admin's own, one's own, or a notice. */
const OUTSIDE: Record<string, string> = {
    "access-reviews": "the Super Admin's", "all-users": "the Super Admin's", "audit-logs": "the Super Admin's",
    "check-ins": "the Super Admin's", "client-messages": "the Super Admin's", "companies": "the Super Admin's",
    "companies/[id]/payments": "the Super Admin's", "companies/[id]/settings": "the Super Admin's",
    "companies/[id]/settings/client-messages/[kind]": "the Super Admin's", "companies/[id]/settings/terminal-guide": "the Super Admin's",
    "health": "the Super Admin's", "packages": "the Super Admin's", "policy-templates": "the Super Admin's",
    "public-holidays": "the Super Admin's", "role-change-requests": "the Super Admin's", "role-templates": "the Super Admin's",
    "super-admins": "the Super Admin's", "system-settings": "the Super Admin's", "terminal-brands": "the Super Admin's",
    "usernames": "the Super Admin's", "who-can": "the Super Admin's", "ui-kit": "the Super Admin's",
    "cash-advances/mine": "one's own", "change-password": "one's own", "email-settings": "one's own", "mfa-settings": "one's own",
    "security-settings": "one's own",
    "maintenance": "a notice", "subscription-expired": "a notice",
    "day-off-requests": `${SENDS_ON} to Requests`, "profile-requests": `${SENDS_ON} to Requests`, "requests/history": `${SENDS_ON} to Requests`,
    "role-requests": `${SENDS_ON} to Roles and access, or Requests`, "records/[id]": `${SENDS_ON} to the record on its client's page`,
    "vendors": `${SENDS_ON} to Clients`, "vendors/[id]": `${SENDS_ON} to the client`,
    // Each part against its route, for every kind of viewer (lib/history-parts.test.ts, PR 370).
    "employees/[id]/history": "tested part by part in lib/history-parts.test.ts",
}

const ROOT = process.cwd()
const DASHBOARD = join(ROOT, "app/(dashboard)/dashboard")

function resolveImport(from: string, spec: string): string | null {
    const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null
    if (!base) return null
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
        if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext
    }
    return null
}

/**
 * The sender a screen gives lib/mobile (lib/mobile/check-in-flow.ts's `Post`):
 * check-in's sends its body as JSON by POST, as a self-test holds (PR 393).
 */
const GIVEN_SENDER = /\bpost: Post\b/

/**
 * A building block that asks the server itself, as the name fields ask for
 * a name's other language (components/ui/NameFields.tsx, PR 402).
 */
const ASKS_ITSELF = /from ['"]swr['"]|\bfetch\(/

/** The files of the building blocks a file takes from their index, components/ui/index.ts (PR 402): all of them for `* as`. */
function blocksTaken(src: string, file: string, index: string): string[] {
    const names = takenFrom(src, file, index)
    const out: string[] = []
    for (const m of readFileSync(index, "utf8").matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        const target = resolveImport(index, m[2])
        if (target && (names.includes("*") || m[1].split(",").some(n => names.includes(n.trim())))) out.push(target)
    }
    return out
}

/** A screen's own files: its page, and the components and hooks it uses, not the building blocks
 * unless one asks the server itself (PR 402); and a lib file that sends through a sender it's given (PR 393). */
function screenFiles(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen
    seen.add(file)
    const src = readFileSync(file, "utf8")
    for (const m of src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        const found = resolveImport(file, m[1])
        if (!found) continue
        const r = relative(ROOT, found)
        if (r.startsWith("components/ui/")) {
            // A building block only where it asks the server itself, taken from their index or by its own path (PR 402).
            const blocks = r === "components/ui/index.ts" ? blocksTaken(src, file, found) : [found]
            for (const block of blocks) if (ASKS_ITSELF.test(readFileSync(block, "utf8"))) screenFiles(block, seen)
            continue
        }
        const follows = r.startsWith("components/") || r.startsWith("app/(dashboard)/") || /^lib\/use[A-Z]/.test(r)
            // A lib file that sends through the sender a screen gives it, as lib/mobile does for check-in (PR 393).
            || (r.startsWith("lib/") && GIVEN_SENDER.test(readFileSync(found, "utf8")))
        if (follows) screenFiles(found, seen)
    }
    return seen
}

const VERB = /['"](GET|POST|PUT|PATCH|DELETE)['"]/g

/**
 * A path from `at` in a string opened by `quote`, to its end: a ${…} right
 * after a slash is a segment, [x]; one added to a segment, as a query is,
 * ends it.
 */
function readPath(src: string, at: number, quote: string): { path: string; end: number } {
    let path = "", j = at
    while (j < src.length) {
        const c = src[j]
        if (c === quote || c === "?" || /\s/.test(c)) break
        if (quote === "`" && c === "$" && src[j + 1] === "{") {
            if (!path.endsWith("/")) break
            let depth = 0, k = j + 1
            for (; k < src.length; k++) { if (src[k] === "{") depth++; else if (src[k] === "}" && --depth === 0) break }
            path += "[x]"
            j = k + 1
            continue
        }
        path += c
        j++
    }
    return { path, end: j }
}

/**
 * The tables of paths in a file (PR 389): `const NAME = { key: '/api/…', … }`,
 * each path by its key, and where the table is, as its entries aren't calls.
 */
function pathTables(src: string): { name: string; from: number; to: number; paths: Record<string, string> }[] {
    const out: { name: string; from: number; to: number; paths: Record<string, string> }[] = []
    for (const m of src.matchAll(/const (\w+)(?::[^=\n]+)? = \{\n([\s\S]*?)\n\}/g)) {
        const paths: Record<string, string> = {}
        for (const e of m[2].matchAll(/^\s+(\w+):\s*['"](\/api\/[^'"]+)['"]/gm)) paths[e[1]] = e[2]
        if (Object.keys(paths).length) out.push({ name: m[1], from: m.index!, to: m.index! + m[0].length, paths })
    }
    return out
}

/**
 * The functions in a file that build a path (PR 394), each by name with where
 * its path starts: an arrow that is the path, `const name = (…) => \`/api/…\``,
 * or a function whose own body returns it. One with no name, built where it's
 * asked, isn't: its path is a call there.
 */
function pathBuilders(src: string): { name: string; at: number }[] {
    const out: { name: string; at: number }[] = []
    for (const m of src.matchAll(/\bconst (\w+) = \([^()]*\)(?::[^=]*)? => `\/api\//g)) out.push({ name: m[1], at: m.index! + m[0].length - 5 })
    for (const m of src.matchAll(/\breturn `\/api\//g)) {
        let depth = 0, k = m.index! - 1
        for (; k >= 0; k--) {
            if (src[k] === "}") depth++
            else if (src[k] === "{" && depth-- === 0) break
        }
        const head = k < 0 ? null : /\bfunction (\w+)\s*\([^)]*\)[^{]*$/.exec(src.slice(Math.max(0, k - 300), k))
        if (head) out.push({ name: head[1], at: m.index! + m[0].length - 5 })
    }
    return out
}

/** The path builders a file imports, by the name it uses for each (PR 394). */
function importedBuilders(src: string, file: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const m of src.matchAll(/import\s+\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        const from = resolveImport(file, m[2])
        if (!from) continue
        const built = readFileSync(from, "utf8")
        const paths = Object.fromEntries(pathBuilders(built).map(b => [b.name, readPath(built, b.at, "`").path]))
        for (const entry of m[1].split(",").map(e => e.trim()).filter(Boolean)) {
            const [name, local = name] = entry.replace(/^type\s+/, "").split(/\s+as\s+/)
            if (paths[name]) out[local] = paths[name]
        }
    }
    return out
}

/** A file's own path builders, each by name with its path (PR 394). */
function ownBuilders(src: string): Record<string, string> {
    return Object.fromEntries(pathBuilders(src).map(b => [b.name, readPath(src, b.at, "`").path]))
}

/** A function handed to a component as a prop that builds a path: `name={(…) => \`/api/…\`}` or `name={(…) => builder(…)}` (PR 395). */
const HANDED = /(\w+)=\{\([^()]*\) => (?:`\/api\/|(\w+)\()/g

/**
 * The props a file hands a path builder, each by the prop's name with its
 * path, to be read where the component calls the prop (PR 395).
 */
function propBuilders(src: string, file: string): Record<string, string> {
    const known = { ...importedBuilders(src, file), ...ownBuilders(src) }
    const out: Record<string, string> = {}
    for (const m of src.matchAll(HANDED)) {
        if (!m[2]) out[m[1]] = readPath(src, m.index! + m[0].length - 5, "`").path
        else if (known[m[2]]) out[m[1]] = known[m[2]]
    }
    return out
}

/**
 * Each call in a file, as "METHOD /api/path": a ${…} right after a slash is a
 * segment, [x]; one added to a segment, as a query is, ends it. A table of
 * paths is read where it's used, `TABLE.key` as that path and `TABLE[…]` as
 * each, with what a template adds after it; so is a path a function builds,
 * its own or one the file imports, `name(…)` as that path (PR 394), and one
 * handed to it as a prop, by the prop's name (`handed`, PR 395).
 */
function callsIn(src: string, file?: string, handed: Record<string, string> = {}): Set<string> {
    const out = new Set<string>()
    const tables = pathTables(src)
    const own = pathBuilders(src)
    // Where a path builder is handed to a component as a prop: not a call there (PR 395).
    const handing = [...src.matchAll(HANDED)].map(m => m.index! + m[0].length - (m[2] ? m[2].length + 1 : 5))
    let i = 0
    while ((i = src.indexOf("/api/", i)) !== -1) {
        const quote = src[i - 1]
        if (!["'", '"', "`"].includes(quote) || tables.some(t => i > t.from && i < t.to) || own.some(b => b.at === i) || handing.includes(i)) { i += 5; continue }
        const { path, end } = readPath(src, i, quote)
        for (const method of methodsOf(src, i - 1)) out.add(`${method} ${path.replace(/\/$/, "")}`)
        i = end
    }
    for (const table of tables) {
        for (const use of src.matchAll(new RegExp(`\\b${table.name}(?:\\.(\\w+)|\\[[^\\]]+\\])`, "g"))) {
            const at = use.index!
            if (at >= table.from && at < table.to) continue
            const bases = use[1] ? [table.paths[use[1]]] : Object.values(table.paths)
            // In a template, as its start: what comes after it is the rest of the path.
            const templated = src.slice(at - 3, at) === "`${"
            const rest = templated ? readPath(src, at + use[0].length + 1, "`").path : ""
            for (const base of bases) for (const method of methodsOf(src, templated ? at - 3 : at)) out.add(`${method} ${(base + rest).replace(/\/$/, "")}`)
        }
    }
    const builders: Record<string, string> = { ...handed, ...(file ? importedBuilders(src, file) : {}), ...ownBuilders(src) }
    for (const [name, path] of Object.entries(builders)) {
        for (const use of src.matchAll(new RegExp(`(^|[^\\w.])${name}\\(`, "g"))) {
            const at = use.index! + use[1].length
            // Not where it's defined, nor where it's handed to a component as a prop.
            if (/function\s+$/.test(src.slice(Math.max(0, at - 9), at)) || handing.includes(at)) continue
            for (const method of methodsOf(src, at)) out.add(`${method} ${path.replace(/\/$/, "")}`)
        }
    }
    return out
}

/**
 * The methods a call sends: GET, unless the path is given to a call, fetch,
 * a helper such as attendance's send, or one a screen writes, as its `act`
 * (PR 391), whose arguments after it name others: as written, built by
 * `json('POST', …)`, given as an argument of its own (`'DELETE'`, PR 394),
 * as both sides of a choice (`editing ? 'PUT' : 'POST'`),
 * or, given as `method`, as declared above it; or given to the sender a
 * screen gives lib/mobile, as POST (PR 393). A path kept in a variable is
 * read where it's written, as GET.
 */
function methodsOf(src: string, start: number): string[] {
    const call = callOf(src, start)
    if (!call) return ["GET"]
    // Given to the sender a screen gives lib/mobile, which sends by POST (PR 393).
    if (call.name === "post" && GIVEN_SENDER.test(src)) return ["POST"]
    let depth = 0, k = start
    for (; k < src.length; k++) {
        const c = src[k]
        if ("([{".includes(c)) depth++
        else if (")]}".includes(c)) { if (depth === 0) break; depth-- }
    }
    const args = src.slice(start, k)
    const verbs = (text: string) => [...new Set([...text.matchAll(VERB)].map(m => m[1]))]
    const given = [
        ...[...args.matchAll(/(?:method:|\bjson\()\s*([^,}\n]+)/g)].flatMap(m => verbs(m[1])),
        // A method given as an argument of its own, as the attendance calendar's helper takes it (PR 394).
        ...topLevelArgs(args).slice(1).flatMap(arg => (/^(['"])(GET|POST|PUT|PATCH|DELETE)\1$/.test(arg) ? [arg.slice(1, -1)] : [])),
    ]
    if (given.length) return [...new Set(given)]
    if (/\bmethod\s*[:,}]/.test(args)) {
        const declared = src.slice(0, start).split("\n").reverse().find(line => /\bmethod\b/.test(line) && verbs(line).length)
        if (declared) return verbs(declared)
    }
    return ["GET"]
}

/** A call's arguments from `args` on, each trimmed: split at its own commas, not those inside brackets (PR 394). */
function topLevelArgs(args: string): string[] {
    const out: string[] = []
    let depth = 0, from = 0
    for (let k = 0; k < args.length; k++) {
        const c = args[k]
        if ("([{".includes(c)) depth++
        else if (")]}".includes(c)) depth--
        else if (c === "," && depth === 0) { out.push(args.slice(from, k).trim()); from = k + 1 }
    }
    out.push(args.slice(from).trim())
    return out
}

/**
 * The call what starts at `start` is given to, by name: the nearest bracket
 * left open before it is a parenthesis, not a function's body or an object
 * (PR 391).
 */
function callOf(src: string, start: number): { name: string } | null {
    let depth = 0
    for (let k = start - 1; k >= 0; k--) {
        const c = src[k]
        if (")]}".includes(c)) depth++
        else if ("([{".includes(c) && depth-- === 0) return c === "(" ? { name: /([\w$]*)\s*$/.exec(src.slice(Math.max(0, k - 40), k))![1] } : null
    }
    return null
}

/** The route files a call can reach: [x] is the dynamic segment, or, with none, any folder. */
function routesFor(path: string): string[] {
    let dirs = [join(ROOT, "app/api")]
    for (const part of path.replace(/^\/api\//, "").split("/")) {
        dirs = dirs.flatMap(dir => {
            if (!existsSync(dir)) return []
            if (part !== "[x]" && existsSync(join(dir, part))) return [join(dir, part)]
            const dynamic = readdirSync(dir).find(d => d.startsWith("["))
            if (dynamic) return [join(dir, dynamic)]
            return part === "[x]" ? readdirSync(dir).map(d => join(dir, d)).filter(d => statSync(d).isDirectory()) : []
        })
    }
    return dirs.map(d => join(d, "route.ts")).filter(f => existsSync(f))
}

const pageFile = (screen: string) => join(DASHBOARD, screen, "page.tsx")
const quoted = (text: string, permission: string) => text.includes(`"${permission}"`) || text.includes(`'${permission}'`)

/** What holding `permission` keeps held with it: what it brings, all the way down, and what it needs first (rules 1 and 2). */
function heldWith(permission: Permission): Set<Permission> {
    const out = new Set<Permission>([permission])
    const add = (p: Permission) => {
        for (const implied of ((PERMISSIONS[p] as { implies?: readonly Permission[] }).implies ?? [])) {
            if (!out.has(implied)) { out.add(implied); add(implied) }
        }
    }
    add(permission)
    for (const needed of requiresOf(permission)) { out.add(needed); add(needed) }
    return out
}

/** A method's handler in a route file: from its export to the next one. */
function handlerOf(route: string, method: string): string | null {
    const src = readFileSync(route, "utf8")
    const parts = src.split(/^(?=export (?:const|async function|function) (?:GET|POST|PUT|PATCH|DELETE)\b)/m)
    return parts.find(part => new RegExp(`^export (?:const|async function|function) ${method}\\b`).test(part)) ?? null
}

const gateCode = (gate: Gate) => (typeof gate === "string" ? gate : gate.code)
const SUPER_ADMIN_WORD = /super_?admin/i

/**
 * What's wrong with a screen's gates: one not in the code as quoted, or a
 * call's gates not naming its permission, or the Super Admin.
 */
function gateProblems(asks: Record<string, Ask>, text: string): string[] {
    const out: string[] = []
    for (const [call, ask] of Object.entries(asks)) {
        if (typeof ask !== "object" || !("gates" in ask || "superAdmin" in ask || "notHere" in ask)) continue
        const gates = "gates" in ask ? ask.gates : "superAdmin" in ask ? ask.superAdmin : ask.notHere
        if (!gates.length) out.push(`${call}: no gate`)
        for (const gate of gates) {
            const where = typeof gate === "string" ? text : readFileSync(join(ROOT, gate.in), "utf8")
            if (!where.includes(gateCode(gate))) out.push(`${call}: not in the code: ${gateCode(gate)}`)
        }
        const codes = gates.map(gateCode).join("\n")
        if ("gates" in ask) for (const p of ask.when) { if (!quoted(codes, p)) out.push(`${call}: no gate naming ${p}`) }
        else if ("superAdmin" in ask && !SUPER_ADMIN_WORD.test(codes)) out.push(`${call}: no gate naming the Super Admin`)
    }
    return out
}

/**
 * What a file's imports take from `target` (PR 392): each name, `default` for
 * a default import, and `*` for all of it, as `* as` or `import()` take; types
 * alone bring no code, so none.
 */
function takenFrom(src: string, file: string, target: string): string[] {
    const out: string[] = []
    for (const m of src.matchAll(/import\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (resolveImport(file, m[2] ?? m[3]) !== target) continue
        if (m[3]) { out.push("*"); continue }
        const clause = m[1].trim()
        if (/^type\b/.test(clause)) continue
        const named = clause.match(/\{([^}]*)\}/)?.[1] ?? ""
        const rest = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim()
        if (rest) out.push(rest.startsWith("*") ? "*" : "default")
        for (const name of named.split(",").map(n => n.trim()).filter(n => n && !n.startsWith("type "))) out.push(name.split(/\s+as\s+/)[0])
    }
    return out
}

/**
 * A call said not to be made here because the screen imports only part of a
 * file, the import quoted as the reason (PR 392): anything else any file of the
 * screen takes from that file, by any path to it, as a second import would
 * otherwise leave real calls marked as not made.
 */
function importProblems(asks: Record<string, Ask>, sources: { file: string; src: string }[]): string[] {
    const out = new Set<string>()
    for (const ask of Object.values(asks)) {
        if (typeof ask !== "object" || !("notHere" in ask)) continue
        for (const code of ask.notHere.map(gateCode)) {
            const quoted = code.match(/^import \{[^}]+\} from '([^']+)'$/)
            const where = quoted && sources.find(s => s.src.includes(code))
            const target = where && resolveImport(where.file, quoted[1])
            if (!where || !target) continue
            const allowed = takenFrom(code, where.file, target)
            for (const { file, src } of sources) {
                for (const name of takenFrom(src, file, target)) if (!allowed.includes(name)) out.add(`${relative(ROOT, file)} takes ${name} from ${relative(ROOT, target)}`)
            }
        }
    }
    return [...out]
}

/** A gated call whose route answers what its gate's permission doesn't keep held. */
function answerProblems(asks: Record<string, Ask>): string[] {
    const out: string[] = []
    for (const [call, ask] of Object.entries(asks)) {
        if (typeof ask !== "object" || !("when" in ask) || !ask.answers) continue
        for (const gate of ask.when) {
            if (!ask.answers.some(p => heldWith(gate).has(p))) out.push(`${gate} asks ${call}, which answers ${ask.answers.join(" or ")}`)
        }
    }
    return out
}

/**
 * A needed call the permissions opening a screen don't keep held, each named;
 * on a screen anyone opens, any needed call.
 */
function openerProblems(opens: Screen["opens"], asks: Record<string, Ask>): string[] {
    const out: string[] = []
    for (const opener of opens === ANYONE ? [ANYONE] : opens) {
        const held = opener === ANYONE ? new Set<Permission>() : heldWith(opener)
        for (const [call, ask] of Object.entries(asks)) {
            if (typeof ask === "object" && "needs" in ask && !ask.needs.some(p => held.has(p))) {
                out.push(`${opener} opens it, but ${call} needs ${ask.needs.join(" or ")}`)
            }
        }
    }
    return out
}

/**
 * What's wrong with a page said to send you on to another: its page doesn't
 * end by sending you on, or it asks the server for something.
 */
function redirectProblems(screen: string): string[] {
    const out: string[] = []
    const page = readFileSync(pageFile(screen), "utf8")
    const lines = page.slice(page.indexOf("export default")).split("\n").map(l => l.trim()).filter(Boolean)
    if (!/^redirect\(/.test(lines[lines.length - 2] ?? "")) out.push(`${screen}: doesn't end by sending you on`)
    const files = [...screenFiles(pageFile(screen))]
    const handed = Object.assign({}, ...files.map(f => propBuilders(readFileSync(f, "utf8"), f)))
    for (const f of files) for (const call of callsIn(readFileSync(f, "utf8"), f, handed)) out.push(`${screen}: asks ${call}`)
    return out
}

describe("every dashboard page", () => {
    // None waits for a part since PR 395: each page is in the table or outside it.
    it("is in the table or outside it, once", () => {
        const pages = (function walk(dir: string): string[] {
            return readdirSync(dir).flatMap(d => {
                const p = join(dir, d)
                return statSync(p).isDirectory() ? walk(p) : d === "page.tsx" ? [relative(DASHBOARD, dir)] : []
            })
        })(DASHBOARD).sort()
        const listed = [...Object.keys(SCREENS), ...Object.keys(OUTSIDE)]
        expect(listed.sort()).toEqual(pages)
    })

    it("sends you on, where it's said to, and asks the server for nothing", () => {
        const sends = Object.entries(OUTSIDE).filter(([, why]) => why.startsWith(SENDS_ON)).map(([page]) => page)
        expect(sends.length).toBeGreaterThan(0)
        expect(sends.flatMap(redirectProblems)).toEqual([])
    })
})

describe.each(Object.entries(SCREENS))("the %s screen", (screen, { opens, asks }) => {
    const files = [...screenFiles(pageFile(screen))]
    const text = files.map(f => readFileSync(f, "utf8")).join("\n")

    it("asks the server for what the table says, each method at each path, no more and no less", () => {
        const found = new Set<string>()
        const handed = Object.assign({}, ...files.map(f => propBuilders(readFileSync(f, "utf8"), f)))
        for (const f of files) for (const call of callsIn(readFileSync(f, "utf8"), f, handed)) found.add(call)
        expect([...found].sort()).toEqual(Object.keys(asks).sort())
    })

    it("asks routes whose handler for that method answers as the table says", () => {
        for (const [call, ask] of Object.entries(asks)) {
            // Never sent from here: a table's path joined to another kind's ending may have no route at all (PR 389).
            if (typeof ask === "object" && "notHere" in ask) continue
            const [method, path] = call.split(" ")
            const reached = routesFor(path)
            expect(reached.length, call).toBeGreaterThan(0)
            const routes = typeof ask === "object" && "routes" in ask && ask.routes ? ask.routes.map(r => join(ROOT, "app/api", r, "route.ts")) : reached
            const handlers: string[] = []
            for (const route of routes) {
                expect(reached, `${call}: ${route}`).toContain(route)
                const handler = handlerOf(route, method)
                expect(handler, `${call}: ${relative(ROOT, route)} has no ${method}`).not.toBeNull()
                handlers.push(handler!)
            }
            const answers = [...handlers, ...(typeof ask === "object" && "routeChecks" in ask && ask.routeChecks ? [ask.routeChecks].flat().map(f => readFileSync(join(ROOT, f), "utf8")) : [])].join("\n")
            if (typeof ask === "object" && "superAdmin" in ask) expect(SUPER_ADMIN_WORD.test(answers), call).toBe(true)
            if (typeof ask === "object" && ("needs" in ask || "when" in ask)) {
                for (const p of "needs" in ask ? ask.needs : ask.answers ?? ask.when) expect(quoted(answers, p), `${call}: ${p}`).toBe(true)
            }
        }
    })

    it("asks each call that's only for some only where the code quoted decides it", () => {
        expect(gateProblems(asks, text)).toEqual([])
    })

    it("needs nothing the permission that opens it doesn't keep held, nor anything if anyone opens it", () => {
        expect(openerProblems(opens, asks)).toEqual([])
    })

    it("answers each call that's only for some for whoever its gate lets ask it", () => {
        expect(answerProblems(asks)).toEqual([])
    })

    it("takes nothing else from a file whose calls it says aren't made here (PR 392)", () => {
        expect(importProblems(asks, files.map(file => ({ file, src: readFileSync(file, "utf8") })))).toEqual([])
    })
})

describe("the test itself", () => {
    it("finds a call written each way: a string, a path with segments, and one with a query", () => {
        expect([...callsIn("fetch('/api/lists')")]).toEqual(["GET /api/lists"])
        expect([...callsIn("fetch(`/api/users/${id}/reset-points`)")]).toEqual(["GET /api/users/[x]/reset-points"])
        expect([...callsIn("useSWR(`/api/clients${q ? `?${q}` : ''}`)")]).toEqual(["GET /api/clients"])
        expect([...callsIn("fetch(`/api/payroll/${year}/${month}${companyId ? `?c=${companyId}` : ''}`)")]).toEqual(["GET /api/payroll/[x]/[x]"])
        expect([...callsIn("const s = 'see /api/x in the docs'")]).toEqual([])
    })

    it("tells each call's method: as written, both sides of a choice, or as declared", () => {
        expect([...callsIn("await fetch('/api/lists', { method: 'PUT', body })")]).toEqual(["PUT /api/lists"])
        expect([...callsIn("await fetch('/api/locations', {\n method: editing ? 'PUT' : 'POST',\n })")].sort()).toEqual(["POST /api/locations", "PUT /api/locations"])
        expect([...callsIn("const go = async (method: 'POST' | 'PUT' = 'PUT') => {\n await fetch('/api/lists', { method, body })")].sort()).toEqual(["POST /api/lists", "PUT /api/lists"])
        expect([...callsIn("const url = '/api/charges'; await fetch(url, { method: 'POST' })")]).toEqual(["GET /api/charges"])
        expect([...callsIn("const save = async () => {\n    const url = `/api/lists?${params}`\n    await fetch('/api/lists', { method: 'PUT' })\n}")].sort()).toEqual(["GET /api/lists", "PUT /api/lists"])
    })

    it("tells it from the call the path is given to: a helper such as attendance's send, or a screen's own, its options written or built by json (PR 391)", () => {
        expect([...callsIn("const r = await send('/api/attendance/codes', json('POST', { code }), t('x'))")]).toEqual(["POST /api/attendance/codes"])
        expect([...callsIn("const r = await send(`/api/attendance/codes/${removing.id}`, { method: 'DELETE' }, t('x'))")]).toEqual(["DELETE /api/attendance/codes/[x]"])
        expect([...callsIn("void act(`undo:${d.id}`, `/api/attendance/decisions/${d.id}`, { method: 'DELETE' }, 'exc_undone')")]).toEqual(["DELETE /api/attendance/decisions/[x]"])
        expect([...callsIn("await send('/api/consent', accept ? json('POST', { version }) : { method: 'DELETE' }, '')")].sort()).toEqual(["DELETE /api/consent", "POST /api/consent"])
        // Asked for, or shown: read.
        expect([...callsIn("useSWR(on ? `/api/attendance/people?${q}` : null, fetcher)")]).toEqual(["GET /api/attendance/people"])
        expect([...callsIn("<Photo src={`/api/face/${id}/photo?which=new`} label={t('x')} />")]).toEqual(["GET /api/face/[x]/photo"])
    })

    it("reads a path a function builds where it's used, with the method of the call it's given to, not where it's built (PR 394)", () => {
        // Built and used in one file, by an arrow or by a function's own return.
        expect([...callsIn("const address = (p: Payment) => `/api/companies/${p.companyId}/payments/${p.id}`\nawait fetch(address(p), { method: 'PUT', body })")])
            .toEqual(["PUT /api/companies/[x]/payments/[x]"])
        expect([...callsIn("export function usersQuery(q: Query): string {\n    const params = new URLSearchParams()\n    if (q.page) { params.set('page', q.page) }\n    return `/api/users?${params}`\n}\nawait fetch(usersQuery(q), { method: 'POST' })")])
            .toEqual(["POST /api/users"])
        // Built where it's asked, by a function with no name: a call there, as before.
        expect([...callsIn("useSWRInfinite((i, previous) => {\n    return `/api/attendance/discrepancies${q}`\n}, fetcher)")]).toEqual(["GET /api/attendance/discrepancies"])
        // Built in another file it imports, by its own name or another.
        const card = join(ROOT, "components/client-messages/CompanyMessagesCard.tsx")
        expect([...callsIn("import { nizmoAgainApi } from '@/lib/client-message-pages'\nawait fetch(nizmoAgainApi(scope, kind), { method: 'DELETE' })", card)]).toEqual(["DELETE /api/company-messages/[x]"])
        expect([...callsIn("import { taxEmailsApi as emails } from '@/lib/client-message-pages'\nuseSWR(emails(scope), fetcher)", card)]).toEqual(["GET /api/company-messages/emails"])
        // Built, never used: no call.
        expect([...callsIn("export const companyMessagesApi = (companyId: string | null) => `/api/company-messages${named(companyId)}`")]).toEqual([])
    })

    it("reads a path built by a function handed to a component as a prop where the component calls it (PR 395)", () => {
        const page = join(ROOT, "components/client-messages/CompanyMessagePage.tsx")
        const handing = "import { companyMessageApi } from '@/lib/client-message-pages'\n<MessageEditor saveUrl={(kind, language) => companyMessageApi(scope, kind, language)} />"
        const editor = "const res = await fetch(saveUrl(kind, language), {\n    method: 'PUT',\n})"
        // Where it's handed over isn't a call; the prop is a builder by its name.
        expect([...callsIn(handing, page)]).toEqual([])
        expect(propBuilders(handing, page)).toEqual({ saveUrl: "/api/company-messages/[x]/[x]" })
        expect(propBuilders("<MessageEditor saveUrl={(kind, language) => `/api/client-messages/${kind}/${language}`} />", page)).toEqual({ saveUrl: "/api/client-messages/[x]/[x]" })
        expect([...callsIn("<MessageEditor saveUrl={(kind, language) => `/api/client-messages/${kind}/${language}`} />", page)]).toEqual([])
        expect([...callsIn(editor, page, propBuilders(handing, page))]).toEqual(["PUT /api/company-messages/[x]/[x]"])
        // A prop handed anything else isn't one.
        expect(propBuilders("<Logo onChanged={(logoUrl: string | null) => onSaved({ logoUrl })} />", page)).toEqual({})
    })

    it("tells it from a method given as an argument of its own, as the attendance calendar's helper takes it (PR 394)", () => {
        expect([...callsIn("run: () => send(`/api/attendance/versions/${v.id}`, 'DELETE', undefined, t('attendance_withdrawn')),")]).toEqual(["DELETE /api/attendance/versions/[x]"])
        expect([...callsIn("ok = await send('/api/attendance/schedules', 'POST', { companyId, ...payload }, t('done'))")]).toEqual(["POST /api/attendance/schedules"])
        // A verb given to a call inside another argument isn't this call's.
        expect([...callsIn("await send('/api/attendance/schedules', 'POST', label(kind, 'PUT', size))")]).toEqual(["POST /api/attendance/schedules"])
        expect([...callsIn("useSWR(['/api/attendance/calendar', 'x'], fetcher)")]).toEqual(["GET /api/attendance/calendar"])
    })

    it("reads a call through the sender a screen gives lib/mobile as POST, and no other call so (PR 393)", () => {
        const flow = "export async function registerPhone(device: CheckInDevice, post: Post) {\n    const { nonce } = await post(\"/api/attendance/phone/challenge\", { purpose: \"REGISTER\" })\n}"
        expect([...callsIn(flow)]).toEqual(["POST /api/attendance/phone/challenge"])
        // A function of the same name that isn't the sender it's given.
        expect([...callsIn("const post = (url: string) => fetch(url)\nawait post('/api/lists', {})")]).toEqual(["GET /api/lists"])
        // Beside the sender it's given, a call not sent through it is read as it's written.
        expect([...callsIn("export async function f(post: Post) {\n    const tasks = await fetcher('/api/attendance/missions/tasks')\n    await post('/api/attendance/missions', {})\n}")].sort())
            .toEqual(["GET /api/attendance/missions/tasks", "POST /api/attendance/missions"])
    })

    it("follows a lib file that sends through the sender it's given, and no other lib file (PR 393)", () => {
        const files = [...screenFiles(pageFile("check-in"))].map(f => relative(ROOT, f))
        expect(files).toEqual(expect.arrayContaining(["lib/mobile/check-in-flow.ts", "lib/mobile/face.ts", "lib/mobile/push.ts"]))
        expect(files.filter(f => f.startsWith("lib/") && !/^lib\/use[A-Z]/.test(f)).sort()).toEqual(["lib/mobile/check-in-flow.ts", "lib/mobile/face.ts", "lib/mobile/push.ts"])
    })

    it("follows a building block that asks the server itself, and no other building block (PR 402)", () => {
        const blocks = (file: string) => [...screenFiles(file)].map(f => relative(ROOT, f)).filter(f => f.startsWith("components/ui/"))
        expect(blocks(pageFile("employees/new"))).toEqual(["components/ui/NameFields.tsx"])
        // By its own path, or all of their index at once.
        const dir = mkdtempSync(join(tmpdir(), "screen-asks-"))
        try {
            writeFileSync(join(dir, "own.tsx"), "import { NameFields } from '@/components/ui/NameFields'\nimport { Button } from '@/components/ui/Button'\n")
            writeFileSync(join(dir, "all.tsx"), "import * as ui from '@/components/ui'\n")
            expect(blocks(join(dir, "own.tsx"))).toEqual(["components/ui/NameFields.tsx"])
            expect(blocks(join(dir, "all.tsx"))).toEqual(["components/ui/NameFields.tsx"])
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
        expect(ASKS_ITSELF.test("const { data } = useSWR(path, fetcher)")).toBe(false)
        expect(ASKS_ITSELF.test("import useSWR from 'swr'")).toBe(true)
        expect(ASKS_ITSELF.test("const r = await fetch(url)")).toBe(true)
    })

    it("is right that the senders check-in gives lib/mobile send by POST (PR 393)", () => {
        // Each function shaped as lib/mobile's Post, (url, body), sends its body as JSON by POST.
        const screen = readFileSync(join(DASHBOARD, "check-in/CheckInScreen.tsx"), "utf8")
        const senders = [...screen.matchAll(/const (\w+) = async \(url: string, body: unknown\) =>/g)].map(m => m[1])
        const posting = [...screen.matchAll(/const (\w+) = async \(url: string, body: unknown\) => \{\n\s+const r = await send\(url, json\('POST', body\)/g)].map(m => m[1])
        expect(senders).toEqual(["quiet", "post"])
        expect(posting).toEqual(senders)
    })

    it("reads a table of paths as its uses, not its entries (PR 389)", () => {
        const table = "const API: Record<Kind, string> = {\n    a: '/api/alpha',\n    // A note.\n    b: '/api/beta',\n}\n"
        expect([...callsIn(table)]).toEqual([])
        expect([...callsIn(`${table}await fetch(API.a, { method: 'POST' })`)]).toEqual(["POST /api/alpha"])
        expect([...callsIn(`${table}await fetch(\`\${API[kind]}/\${id}/decide\`, { method: 'POST' })`)].sort()).toEqual(["POST /api/alpha/[x]/decide", "POST /api/beta/[x]/decide"])
        expect([...callsIn(`${table}await fetch(\`\${API.b}/\${id}\`, { method: 'DELETE' })`)]).toEqual(["DELETE /api/beta/[x]"])
        expect([...callsIn(`${table}const url = API.a`)]).toEqual(["GET /api/alpha"])
    })

    it("reads only the handler for the method", () => {
        const route = join(ROOT, "app/api/payroll/[year]/[month]/route.ts")
        expect(handlerOf(route, "GET")).toContain("export const GET")
        expect(handlerOf(route, "GET")).not.toContain("export const POST")
        expect(handlerOf(route, "DELETE")).toBeNull()
    })

    it("finds a gate that isn't there, or doesn't name its permission or the Super Admin", () => {
        const code = "const mayAdd = can('clients.create')\nconst everyCompany = superAdmin && !selectedCompanyId"
        expect(gateProblems({ "POST /api/clients": when("clients.create", "const mayAdd = can('clients.create')") }, code)).toEqual([])
        expect(gateProblems({ "POST /api/clients": when("clients.create", "const mayEdit = can('clients.edit')") }, code)).toHaveLength(2)
        expect(gateProblems({ "POST /api/clients": when("clients.delete", "const mayAdd = can('clients.create')") }, code)).toEqual(["POST /api/clients: no gate naming clients.delete"])
        expect(gateProblems({ "GET /api/companies": superAdmin("const mayAdd = can('clients.create')") }, code)).toEqual(["GET /api/companies: no gate naming the Super Admin"])
        expect(gateProblems({ "GET /api/companies": superAdmin("const everyCompany = superAdmin && !selectedCompanyId") }, code)).toEqual([])
    })

    it("finds a gated call answered for what its gate's permission doesn't keep held", () => {
        const leaders = (answers: Permission[]): Ask => ({ when: ["employees.assign_team"], gates: [], answers })
        expect(answerProblems({ "GET /api/users": leaders(["employees.view"]) })).toEqual([])
        expect(answerProblems({ "GET /api/users": leaders(["salary.view"]) })).toEqual(["employees.assign_team asks GET /api/users, which answers salary.view"])
    })

    it("finds a needed call on a screen anyone opens, or one the permission opening it doesn't keep held (PR 387)", () => {
        const asks = { "GET /api/locations": needs("locations.view"), "GET /api/lists": ANYONE }
        expect(openerProblems("anyone", { "GET /api/lists": ANYONE, "POST /api/lists": when("lists.add", "x") })).toEqual([])
        expect(openerProblems("anyone", asks)).toEqual(["anyone opens it, but GET /api/locations needs locations.view"])
        expect(openerProblems(["tasks.create"], asks)).toEqual([])
        expect(openerProblems(["tasks.view"], asks)).toEqual(["tasks.view opens it, but GET /api/locations needs locations.view"])
    })

    it("finds a call not made here whose reason isn't in the code (PR 387)", () => {
        const code = "forTask={{ clientId }}"
        expect(gateProblems({ "PUT /api/locations": notHere("forTask={{ clientId }}") }, code)).toEqual([])
        expect(gateProblems({ "PUT /api/locations": notHere("editing={true}") }, code)).toEqual(["PUT /api/locations: not in the code: editing={true}"])
        expect(gateProblems({ "PUT /api/locations": notHere() }, code)).toEqual(["PUT /api/locations: no gate"])
    })

    it("reads what an import takes: by name, the default, all of it, and no types (PR 392)", () => {
        const tab = join(DASHBOARD, "attendance/RequestsTab.tsx")
        const dialogs = join(DASHBOARD, "requests/AttendanceDialogs.tsx")
        expect(takenFrom("import { AskPermission, ReportMissingPunch } from '../requests/AttendanceDialogs'", tab, dialogs)).toEqual(["AskPermission", "ReportMissingPunch"])
        expect(takenFrom("import Dialogs, { AskPermission as Ask } from '../requests/AttendanceDialogs'", tab, dialogs)).toEqual(["default", "AskPermission"])
        expect(takenFrom("import * as dialogs from '@/app/(dashboard)/dashboard/requests/AttendanceDialogs'", tab, dialogs)).toEqual(["*"])
        expect(takenFrom("const d = await import('../requests/AttendanceDialogs')", tab, dialogs)).toEqual(["*"])
        expect(takenFrom("import type { FeedRow } from '../requests/AttendanceDialogs'\nimport { type FeedRow, AskMission } from '../requests/AttendanceDialogs'", tab, dialogs)).toEqual(["AskMission"])
        expect(takenFrom("import { send } from './send'", tab, dialogs)).toEqual([])
    })

    it("finds a screen taking more from a file whose calls it says aren't made here, by any path to it (PR 392)", () => {
        const tab = join(DASHBOARD, "attendance/RequestsTab.tsx")
        const page = join(DASHBOARD, "attendance/page.tsx")
        const asks = { "POST /api/attendance/missions": notHere("import { AskPermission } from '../requests/AttendanceDialogs'") }
        const only = { file: tab, src: "import { AskPermission } from '../requests/AttendanceDialogs'" }
        expect(importProblems(asks, [only])).toEqual([])
        expect(importProblems(asks, [{ ...only, src: `${only.src}\nimport { AskMission } from '../requests/AttendanceDialogs'` }]))
            .toEqual(["app/(dashboard)/dashboard/attendance/RequestsTab.tsx takes AskMission from app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx"])
        expect(importProblems(asks, [only, { file: page, src: "import Dialogs from '@/app/(dashboard)/dashboard/requests/AttendanceDialogs'" }]))
            .toEqual(["app/(dashboard)/dashboard/attendance/page.tsx takes default from app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx"])
        // A reason that isn't an import is gateProblems' alone.
        expect(importProblems({ "PUT /api/locations": notHere("forTask={{ clientId }}") }, [only])).toEqual([])
    })

    it("finds a page said to send you on that asks for something or doesn't send you on (PR 387)", () => {
        expect(redirectProblems("vendors")).toEqual([])
        // It sends an old address on, but ends showing the list.
        expect(redirectProblems("tasks")).toEqual(expect.arrayContaining(["tasks: doesn't end by sending you on", "tasks: asks GET /api/realtime/token"]))
        expect(redirectProblems("obligations")).toEqual(["obligations: doesn't end by sending you on", "obligations: asks GET /api/users", "obligations: asks GET /api/clients", "obligations: asks GET /api/locations"])
    })

    it("keeps held what a permission brings and needs first, and nothing else", () => {
        expect([...heldWith("payroll.prepare")].sort()).toEqual(["payroll.prepare", "payroll.view", "salary.view"])
        expect(heldWith("salary_adjustments.add").has("employees.view")).toBe(true)
        expect(heldWith("locations.view").has("clients.view")).toBe(false)
    })
})
