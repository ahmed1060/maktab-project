import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "@/lib/strip-comments"
import { permissionsOf, type Can } from "@/lib/useCan"
import { withGrants } from "./test-actors"

/**
 * Every role check a screen made, and the permission question that replaced it.
 *
 * Screens cannot be driven the way the routes are, so the record is kept in two
 * halves. `before` is the old condition, copied from the code as it stood — the
 * role names are the record. `now` is the expression the screen asks today, and
 * `uses` is that expression as it appears in the file, so the pair cannot drift
 * apart: rewrite the screen and the snippet stops matching; change a grant in
 * lib/permissions/built-in.ts and `now` stops agreeing with `before`.
 *
 * Each pair is checked for every kind of viewer, and — where the old condition
 * also asked something about the record, such as "is this person on the task"
 * — for both answers to that.
 *
 * Left out on purpose: Super Admin tools (companies, packages, system settings,
 * audit logs, the company switcher), which stay outside the permission system,
 * and checks on another person's role ("is this row an Admin"), which ask what
 * somebody is, not what the viewer may do.
 */

type Role = "SUPER_ADMIN" | "ADMIN" | "TEAM_LEADER" | "EMPLOYEE"
const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "TEAM_LEADER", "EMPLOYEE"]
const ACTOR: Record<Role, { role: Role; id: string; companyId: string | null; grants?: string }> = {
    SUPER_ADMIN: { role: "SUPER_ADMIN", id: "sa", companyId: null },
    ADMIN: withGrants({ role: "ADMIN", id: "admin", companyId: "c1" }),
    TEAM_LEADER: withGrants({ role: "TEAM_LEADER", id: "tl", companyId: "c1" }),
    EMPLOYEE: withGrants({ role: "EMPLOYEE", id: "emp", companyId: "c1" }),
}

type Gate = {
    what: string
    file: string | string[]
    uses: string
    before: (role: Role, flag: boolean) => boolean
    now: (p: Can, flag: boolean, role: Role) => boolean
}

const managers = (r: Role) => ["ADMIN", "SUPER_ADMIN", "TEAM_LEADER"].includes(r)
const admins = (r: Role) => ["ADMIN", "SUPER_ADMIN"].includes(r)

const D = "app/(dashboard)/dashboard/"
const TASK = D + "tasks/[id]/client.tsx"
const OBL = D + "obligations/[id]/client.tsx"
const FORM = "components/EmployeeProfileForm.tsx"
const PEOPLE = D + "employees/page.tsx"

const GATES: Gate[] = [
    // --- Vendors, clients, costs ---------------------------------------------
    { what: "vendors: manage", file: D + "vendors/page.tsx", uses: "useCan().can('vendors.manage')", before: admins, now: p => p.can("vendors.manage") },
    { what: "new task: pick a vendor", file: D + "tasks/new/page.tsx", uses: "useCan().can('vendors.view')", before: managers, now: p => p.can("vendors.view") },
    { what: "client notes: add and edit", file: D + "clients/[id]/sections/[sectionId]/page.tsx", uses: "const canEdit = can('clients.contribute')", before: () => true, now: p => p.can("clients.contribute") },
    { what: "client notes: delete", file: D + "clients/[id]/sections/[sectionId]/page.tsx", uses: "const canDelete = can('clients.delete')", before: r => r === "SUPER_ADMIN" || r === "ADMIN", now: p => p.can("clients.delete") },
    { what: "costs page: open", file: D + "costs/page.tsx", uses: "if (!can(session.user as any, 'tasks.pay'))", before: managers, now: p => p.can("tasks.pay") },
    { what: "costs: employee layout", file: D + "costs/CostsClient.tsx", uses: "const isEmployee = !can('tasks.pay')", before: r => r === "EMPLOYEE", now: p => !p.can("tasks.pay") },
    { what: "costs: pay everything", file: D + "costs/CostsClient.tsx", uses: "companyWide('tasks.pay') && total > 0", before: admins, now: p => p.companyWide("tasks.pay") },

    // --- Requests and name changes ---------------------------------------------
    { what: "name changes: page", file: D + "profile-requests/page.tsx", uses: "const canReview = permissions.can('profile_requests.review')", before: r => r === "ADMIN" || r === "SUPER_ADMIN", now: p => p.can("profile_requests.review") },
    { what: "name changes: header counter", file: "components/DashboardHeader.tsx", uses: "permissionsOf(currentUser as any).can('profile_requests.review')", before: admins, now: p => p.can("profile_requests.review") },
    { what: "request card: who raised it", file: "components/requests/RequestCard.tsx", uses: "const canSeeWho = can('requests.view')", before: managers, now: p => p.can("requests.view") },
    { what: "request card: change status", file: "components/requests/RequestCard.tsx", uses: "const canReview = can('requests.review')", before: managers, now: p => p.can("requests.review") },
    { what: "request modal: change status", file: "components/requests/ViewRequestModal.tsx", uses: "const canReview = useCan().can('requests.review')", before: managers, now: p => p.can("requests.review") },
    { what: "requests: employee filters", file: ["components/requests/RequestsSection.tsx", D + "requests/history/RequestsHistoryClient.tsx"], uses: "const seesOthersRequests = useCan().can('requests.view')", before: r => r === "EMPLOYEE", now: p => !p.can("requests.view") },

    // --- Sidebar and dashboard --------------------------------------------------
    { what: "sidebar: costs", file: "components/DashboardShell.tsx", uses: "costs: 'tasks.pay'", before: managers, now: p => p.can("tasks.pay") },
    { what: "sidebar: employees", file: "components/DashboardShell.tsx", uses: "employees: 'employees.view'", before: managers, now: p => p.can("employees.view") },
    { what: "sidebar: vendors", file: "components/DashboardShell.tsx", uses: "vendors: 'vendors.view'", before: managers, now: p => p.can("vendors.view") },
    { what: "sidebar: payroll", file: "components/DashboardShell.tsx", uses: "const canSeePayroll = permissions.can('payroll.view')", before: admins, now: p => p.can("payroll.view") },
    { what: "dashboard: overview", file: D + "page.tsx", uses: "if (can(viewer, 'tasks.view'))", before: managers, now: p => p.can("tasks.view") },
    { what: "dashboard: team title", file: D + "page.tsx", uses: "grantFor(viewer, 'tasks.view') === 'TEAM'", before: r => r === "TEAM_LEADER", now: p => p.scope("tasks.view") === "TEAM" },
    { what: "dashboard: add employee (in the overview)", file: D + "page.tsx", uses: "can(viewer, 'employees.create') && (", before: r => managers(r) && r !== "TEAM_LEADER", now: p => p.can("tasks.view") && p.can("employees.create") },

    // --- Day off and payroll ---------------------------------------------------
    { what: "day off: the company's requests", file: D + "day-off-requests/page.tsx", uses: "const managesRequests = can('dayoff.view')", before: admins, now: p => p.can("dayoff.view") },
    { what: "day off: decide", file: D + "day-off-requests/page.tsx", uses: "const canDecide = can('dayoff.approve')", before: admins, now: p => p.can("dayoff.approve") },
    // Added in Part B: the buttons on one request, never one's own.
    { what: "day off: decide this one (flag: one's own)", file: D + "day-off-requests/page.tsx", uses: "canFor('dayoff.approve', req.userId)", before: (r, own) => admins(r) && !own, now: (p, own, role) => p.canFor("dayoff.approve", own ? ACTOR[role].id : "someone-else") },
    { what: "name changes: decide this one (flag: one's own)", file: D + "profile-requests/page.tsx", uses: "permissions.canFor('profile_requests.review', req.userId)", before: (r, own) => admins(r) && !own, now: (p, own, role) => p.canFor("profile_requests.review", own ? ACTOR[role].id : "someone-else") },
    { what: "payroll: save draft", file: D + "payroll/page.tsx", uses: "const canPrepare = can('payroll.prepare')", before: admins, now: p => p.can("payroll.prepare") },
    { what: "payroll: approve", file: D + "payroll/page.tsx", uses: "const canApprove = can('payroll.approve')", before: admins, now: p => p.can("payroll.approve") },
    { what: "payroll: delivery", file: D + "payroll/page.tsx", uses: "const canDeliver = can('payroll.issue_payslips') || can('payroll.mark_paid')", before: admins, now: p => p.can("payroll.issue_payslips") || p.can("payroll.mark_paid") },
    { what: "payroll: waive a debt", file: D + "payroll/page.tsx", uses: "const canWaive = can('debts.waive')", before: admins, now: p => p.can("debts.waive") },

    // --- Employees -------------------------------------------------------------
    { what: "history: settlements", file: D + "employees/[id]/history/page.tsx", uses: "can('settlements.manage') && id", before: admins, now: p => p.can("settlements.manage") },
    { what: "history: debts", file: D + "employees/[id]/history/page.tsx", uses: "can('debts.view') && id", before: admins, now: p => p.can("debts.view") },
    { what: "history: salary label", file: D + "employees/[id]/history/page.tsx", uses: "const canSeeSalary = can('salary.view')", before: admins, now: p => p.can("salary.view") },
    // Changed in Part B: not on one's own pay (ROLES_PLAN.md §4.2, rule 5).
    // Recorded first as admins(r), own page or not.
    { what: "history: adjustments (flag: one's own page)", file: D + "employees/[id]/history/page.tsx", uses: "const canAdjust = canFor('salary_adjustments.manage', params.id as string | undefined)", before: (r, own) => admins(r) && !own, now: (p, own, role) => p.canFor("salary_adjustments.manage", own ? ACTOR[role].id : "someone-else") },
    { what: "history: re-evaluate day off", file: D + "employees/[id]/history/page.tsx", uses: "const canReevaluateDayOff = can('dayoff.approve')", before: admins, now: p => p.can("dayoff.approve") },
    { what: "new employee: team leader", file: D + "employees/new/page.tsx", uses: "const canAssignTeam = can('employees.assign_team')", before: r => r === "SUPER_ADMIN" || r === "ADMIN", now: p => p.can("employees.assign_team") },
    { what: "new employee: role", file: D + "employees/new/page.tsx", uses: "const canAssignRole = can('employees.assign_role')", before: r => r === "SUPER_ADMIN" || r === "ADMIN", now: p => p.can("employees.assign_role") },
    { what: "employees: team-only list", file: PEOPLE, uses: "can('employees.view') && !companyWide('employees.view')", before: r => r === "TEAM_LEADER", now: p => p.can("employees.view") && !p.companyWide("employees.view") },
    { what: "employees: page", file: PEOPLE, uses: "if (session?.user && !can('employees.view'))", before: r => r !== "EMPLOYEE", now: p => p.can("employees.view") },
    { what: "employees: assign teams", file: PEOPLE, uses: "const canAssignTeams = can('employees.assign_team')", before: admins, now: p => p.can("employees.assign_team") },
    { what: "employees: add", file: PEOPLE, uses: "can('employees.create') && (", before: admins, now: p => p.can("employees.create") },
    { what: "employees: actions row", file: PEOPLE, uses: "{canActOnPeople && (", before: admins, now: p => ["employees.edit", "salary.view", "salary_adjustments.manage", "requests.reset_points", "employees.delete"].some(x => p.can(x as any)) },
    { what: "employees: edit", file: PEOPLE, uses: "{can('employees.edit') && (emp.role", before: admins, now: p => p.can("employees.edit") },
    { what: "employees: history", file: PEOPLE, uses: "{can('salary.view') && emp.role", before: admins, now: p => p.can("salary.view") },
    { what: "employees: bonus and deduction", file: PEOPLE, uses: "{can('salary_adjustments.manage') && (", before: admins, now: p => p.can("salary_adjustments.manage") },
    { what: "employees: reset points", file: PEOPLE, uses: "{can('requests.reset_points') && (", before: admins, now: p => p.can("requests.reset_points") },
    { what: "employees: delete", file: PEOPLE, uses: "{can('employees.delete') && emp.role", before: admins, now: p => p.can("employees.delete") },
    { what: "profile: sends salary", file: FORM, uses: "salary: can('salary.edit') &&", before: r => r === "ADMIN" || r === "SUPER_ADMIN", now: p => p.can("salary.edit") },
    { what: "profile: sends day-off credit", file: FORM, uses: "baseDayOffCredit: can('dayoff.adjust_credit') &&", before: r => r === "ADMIN" || r === "SUPER_ADMIN", now: p => p.can("dayoff.adjust_credit") },
    { what: "profile: sends status", file: FORM, uses: "status: can('employees.change_status') &&", before: r => r === "ADMIN" || r === "SUPER_ADMIN", now: p => p.can("employees.change_status") },
    { what: "profile: sends team leader", file: FORM, uses: "teamLeaderId: canAssignTeam &&", before: r => r === "ADMIN" || r === "SUPER_ADMIN", now: p => p.can("employees.assign_team") },
    { what: "profile: salary shown (flag: own profile)", file: FORM, uses: "(can('salary.view') || userId === session?.user?.id)", before: (r, self) => admins(r) || self, now: (p, self) => p.can("salary.view") || self },
    { what: "profile: salary editable", file: FORM, uses: "!can('salary.edit')", before: admins, now: p => p.can("salary.edit") },
    { what: "profile: day-off credit shown (flag: own profile)", file: FORM, uses: "(can('dayoff.view') || userId === session?.user?.id)", before: (r, self) => admins(r) || self, now: (p, self) => p.can("dayoff.view") || self },
    { what: "profile: day-off credit editable", file: FORM, uses: "!can('dayoff.adjust_credit')", before: admins, now: p => p.can("dayoff.adjust_credit") },
    { what: "profile: reset password", file: FORM, uses: "can('employees.reset_password') && isViewMode", before: admins, now: p => p.can("employees.reset_password") },
    // B4: shown to whoever may ask for a role too (ROLES_PLAN.md §6.12). No
    // built-in role may only ask, so who sees it is unchanged for them.
    { what: "profile: role", file: FORM, uses: "(can('employees.assign_role') || can('employees.request_role')) && userId", before: r => r === "SUPER_ADMIN" || r === "ADMIN", now: p => p.can("employees.assign_role") || p.can("employees.request_role") },
    { what: "profile: status", file: FORM, uses: "can('employees.change_status') && userId", before: r => r === "SUPER_ADMIN" || r === "ADMIN", now: p => p.can("employees.change_status") },

    // --- Tasks ------------------------------------------------------------------
    { what: "task list: own only", file: D + "tasks/page.tsx", uses: "if (scope === null)", before: r => r === "EMPLOYEE", now: p => p.scope("tasks.view") === null },
    { what: "task list: team views", file: D + "tasks/page.tsx", uses: "} else if (scope === 'TEAM') {", before: r => r === "TEAM_LEADER", now: p => p.scope("tasks.view") === "TEAM" },
    { what: "task list: company", file: D + "tasks/page.tsx", uses: "} else if (scope === 'COMPANY') {", before: r => r === "ADMIN", now: p => p.scope("tasks.view") === "COMPANY" },
    { what: "task page: sees others' tasks", file: D + "tasks/[id]/page.tsx", uses: "const seesOthersTasks = can(viewer, 'tasks.view')", before: r => r !== "EMPLOYEE", now: p => p.can("tasks.view") },
    { what: "tasks: tabs", file: D + "tasks/TasksClient.tsx", uses: "{reach === 'TEAM' && (", before: r => r === "TEAM_LEADER", now: p => p.scope("tasks.view") === "TEAM" },
    { what: "tasks: employee filters", file: D + "tasks/TasksClient.tsx", uses: "isEmployee={reach === null}", before: r => r === "EMPLOYEE", now: p => p.scope("tasks.view") === null },
    { what: "tasks: create", file: D + "tasks/TasksClient.tsx", uses: "can('tasks.create') && (", before: managers, now: p => p.can("tasks.create") },
    { what: "task: overdue lock (flag: on the task)", file: TASK, uses: "const isRestrictedRole = !seesOthersTasks || (teamReach && isUserAssignee)", before: (r, on) => r === "EMPLOYEE" || (r === "TEAM_LEADER" && on), now: (p, on) => !p.can("tasks.view") || (p.scope("tasks.view") === "TEAM" && on) },
    { what: "task: acts as assignee (flag: on the task)", file: TASK, uses: "(!seesOthersTasks || isOnTask)", before: (r, on) => r === "EMPLOYEE" || on, now: (p, on) => !p.can("tasks.view") || on },
    { what: "task: transfer", file: TASK, uses: "const canTransfer = can('tasks.transfer')", before: managers, now: p => p.can("tasks.transfer") },
    { what: "task: mark paid", file: TASK, uses: "companyWide('tasks.pay') && (", before: admins, now: p => p.companyWide("tasks.pay") },
    ...(["tasks.edit", "tasks.delete", "tasks.review"] as const).map((perm): Gate => ({
        what: `task: ${perm} (flag: on the task)`, file: TASK, uses: `mayManage('${perm}')`,
        before: (r, on) => managers(r) && (r === "TEAM_LEADER" || !on),
        now: (p, on) => p.can(perm) && (p.scope(perm) === "TEAM" || !on),
    })),
    { what: "task: remove an attachment (flag: uploaded it)", file: TASK, uses: "(att.uploadedById === userId || can('tasks.edit'))", before: (r, mine) => mine || managers(r), now: (p, mine) => mine || p.can("tasks.edit") },
    { what: "task: remove a note (flag: wrote it)", file: TASK, uses: "(log.authorId === userId || canEditTask)", before: (r, mine) => mine || managers(r), now: (p, mine) => mine || p.can("tasks.edit") },
    { what: "task: remove a cost (flag: added it)", file: "components/TaskCostsSection.tsx", uses: "(c.authorId === userId || can('tasks.edit'))", before: (r, mine) => mine || managers(r), now: (p, mine) => mine || p.can("tasks.edit") },
    { what: "task: individual settlements", file: "components/TaskCostsSection.tsx", uses: "can('tasks.pay') && !['PENDING', 'IN_PROGRESS']", before: managers, now: p => p.can("tasks.pay") },
    { what: "task: penalty", file: "components/TaskLocationHistorySection.tsx", uses: "can('tasks.penalize') && !['PENDING', 'IN_PROGRESS']", before: managers, now: p => p.can("tasks.penalize") },
    { what: "task: verify a location", file: "components/TaskLocationHistorySection.tsx", uses: "const canVerify = can('tasks.review')", before: managers, now: p => p.can("tasks.review") },
    { what: "task: delete a location (flag: on the task)", file: "components/TaskLocationHistorySection.tsx", uses: "(!can('tasks.view') || task.assignees", before: (r, on) => r === "EMPLOYEE" || on, now: (p, on) => !p.can("tasks.view") || on },
    { what: "task: delete a location entry (flag: added it)", file: "components/TaskLocationHistorySection.tsx", uses: "(loc.authorId === userId || can('tasks.edit'))", before: (r, mine) => mine || managers(r), now: (p, mine) => mine || p.can("tasks.edit") },

    // --- Obligations -------------------------------------------------------------
    { what: "obligations: create", file: D + "obligations/ObligationsClient.tsx", uses: "permissions.can('obligations.manage') && (", before: managers, now: p => p.can("obligations.manage") },
    { what: "obligations: employee filters", file: D + "obligations/ObligationsClient.tsx", uses: "isEmployee={!permissions.can('obligations.view')}", before: r => r === "EMPLOYEE", now: p => !p.can("obligations.view") },
    { what: "new obligation: team-only picker", file: D + "obligations/new/page.tsx", uses: "permissions.can('obligations.manage') && !permissions.companyWide('obligations.manage')", before: r => r === "TEAM_LEADER", now: p => p.can("obligations.manage") && !p.companyWide("obligations.manage") },
    { what: "obligation: overdue lock (flag: on it)", file: OBL, uses: "const isRestrictedRole = !seesOthers || (teamReach && isUserAssignee)", before: (r, on) => r === "EMPLOYEE" || (r === "TEAM_LEADER" && on), now: (p, on) => !p.can("obligations.view") || (p.scope("obligations.view") === "TEAM" && on) },
    { what: "obligation: acts as assignee", file: OBL, uses: "{!seesOthers && !['PENDING_CONFIRMATION'", before: r => r === "EMPLOYEE", now: p => !p.can("obligations.view") },
    { what: "obligation: manage", file: OBL, uses: "const canManage = can('obligations.manage')", before: managers, now: p => p.can("obligations.manage") },
    { what: "obligation: edit, delete, decide (flag: on it)", file: OBL, uses: "const mayManageThis = canManage && (scope('obligations.manage') === 'TEAM' || !obligation.assignees", before: (r, on) => managers(r) && (r === "TEAM_LEADER" || !on), now: (p, on) => p.can("obligations.manage") && (p.scope("obligations.manage") === "TEAM" || !on) },
    { what: "obligation: remove an attachment (flag: uploaded it)", file: OBL, uses: "canManage && (att.uploadedById === userId || companyWide('obligations.manage'))", before: (r, mine) => managers(r) && (mine || admins(r)), now: (p, mine) => p.can("obligations.manage") && (mine || p.companyWide("obligations.manage")) },
    { what: "obligation: team-only picker", file: OBL, uses: "canManage && !companyWide('obligations.manage') ?", before: r => r === "TEAM_LEADER", now: p => p.can("obligations.manage") && !p.companyWide("obligations.manage") },
]

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
    }
    return out
}

const sources = new Map<string, string>()
const source = (path: string) => {
    if (!sources.has(path)) sources.set(path, stripComments(readFileSync(path, "utf8")))
    return sources.get(path)!
}

describe("no screen rebuilds a viewer from a role name", () => {
    // A role's name says nothing about what it holds once roles are data:
    // permissionsOf({ role }) would answer every custom role as nobody. The
    // viewer comes from useCan() — the session, or the layout's copy of it.
    it("never passes permissionsOf an actor built from a role", () => {
        const screens = ["app", "components"].flatMap(dir => walk(dir))
        const offenders = screens.filter(file => /permissionsOf\(\s*\{\s*role\b/.test(source(file)))
        expect(offenders).toEqual([])
    })
})

describe("each screen gate asks what it replaced", () => {
    for (const gate of GATES) {
        describe(gate.what, () => {
            for (const file of ([] as string[]).concat(gate.file)) {
                it(`is what ${file} asks`, () => {
                    expect(source(file)).toContain(gate.uses)
                })
            }
            for (const role of ROLES) {
                for (const flag of [false, true]) {
                    it(`answers as before for ${role}${flag ? " (flag set)" : ""}`, () => {
                        expect(gate.now(permissionsOf(ACTOR[role]), flag, role)).toBe(gate.before(role, flag))
                    })
                }
            }
        })
    }
})
