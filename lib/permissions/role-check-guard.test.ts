import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "@/lib/strip-comments"

/**
 * No new decision by role name.
 *
 * What someone may do is can()'s — useCan() on a screen, grantFor() or
 * scopesToTeam() for how far it reaches — so that in Part B a custom role is
 * answered by its grants. A check that names ADMIN, TEAM_LEADER or EMPLOYEE
 * answers only for the built-in roles, and would quietly get every custom one
 * wrong.
 *
 * Some checks rightly name a role, and every one of them is listed below with
 * the reason. The list is a ratchet: a new role check fails here until it is
 * either rewritten as a permission question or added with its reason, in
 * review; a listed check that no longer exists fails too, so the list cannot
 * grow stale. SUPER_ADMIN on its own is not matched — the Super Admin stays
 * outside the permission system (ROLES_PLAN.md).
 */

/** Turning a role into its label, icon or colour. Presentation, not access. */
const LABEL = "label"
/**
 * About the person acted on, not the one acting: only an employee has a team
 * leader, an Admin is not assigned tasks by a Team Leader, an Admin's row has
 * no bonus button. These ask what somebody is.
 */
const THE_PERSON = "about the person acted on"
/**
 * The locked Admin role (ROLES_PLAN.md): only the Super Admin makes, edits or
 * removes an Admin; a lapsed subscription never locks out the company's Admin,
 * who must be able to renew; Admins have no personal history link. These are
 * about the role itself, which no custom role can become.
 */
const ADMIN_ROLE = "the locked Admin role"
/**
 * A cross-company system job an Admin may trigger by hand. No company
 * permission fits it; Part B makes it the Super Admin's.
 */
const SYSTEM_JOB = "system job (Part B: Super Admin only)"

const ALLOWED: [file: string, line: string, why: string][] = [
    // app/api/tasks/bulk/route.ts
    ["app/api/tasks/bulk/route.ts", "if (['ADMIN', 'SUPER_ADMIN'].includes(user.role)) { isTaskValid = false; break }", THE_PERSON],

    // app/api/notes/check-expiry/route.ts
    ["app/api/notes/check-expiry/route.ts", "const isAdmin = session && ['ADMIN', 'SUPER_ADMIN'].includes(role)", SYSTEM_JOB],
    ["app/api/notes/check-expiry/route.ts", "else if (role === 'ADMIN') userId = (session!.user as any).id", SYSTEM_JOB],

    // app/(dashboard)/dashboard/employees/new/page.tsx
    ["app/(dashboard)/dashboard/employees/new/page.tsx", "if (role === 'EMPLOYEE' && teamLeaderId) {", THE_PERSON],
    ["app/(dashboard)/dashboard/employees/new/page.tsx", "{!['ADMIN', 'SUPER_ADMIN'].includes(role) && role !== '' && (", THE_PERSON],
    ["app/(dashboard)/dashboard/employees/new/page.tsx", "{(role === 'EMPLOYEE' || role === 'TEAM_LEADER') && (", THE_PERSON],
    ["app/(dashboard)/dashboard/employees/new/page.tsx", "{role === 'EMPLOYEE' && canAssignTeam && (", THE_PERSON],

    // app/(dashboard)/dashboard/employees/page.tsx
    ["app/(dashboard)/dashboard/employees/page.tsx", "case 'ADMIN':", LABEL],
    ["app/(dashboard)/dashboard/employees/page.tsx", "case 'TEAM_LEADER':", LABEL],
    ["app/(dashboard)/dashboard/employees/page.tsx", "case 'EMPLOYEE':", LABEL],
    ["app/(dashboard)/dashboard/employees/page.tsx", "{canAssignTeams && emp.role === 'EMPLOYEE' && (", THE_PERSON],
    ["app/(dashboard)/dashboard/employees/page.tsx", "{emp.role !== 'ADMIN' && (", THE_PERSON],
    ["app/(dashboard)/dashboard/employees/page.tsx", "{emp.role === 'EMPLOYEE' && (", THE_PERSON],
    ["app/(dashboard)/dashboard/employees/page.tsx", "{can('employees.edit') && (emp.role !== 'ADMIN' || userRole === 'SUPER_ADMIN') && (", THE_PERSON],
    ["app/(dashboard)/dashboard/employees/page.tsx", "{can('salary.view') && emp.role !== 'ADMIN' && (", THE_PERSON],
    ["app/(dashboard)/dashboard/employees/page.tsx", "{emp.role !== 'ADMIN' && (", THE_PERSON],

    // app/(dashboard)/dashboard/all-users/page.tsx
    ["app/(dashboard)/dashboard/all-users/page.tsx", "case 'EMPLOYEE': return 'role_employee'", LABEL],
    ["app/(dashboard)/dashboard/all-users/page.tsx", "case 'TEAM_LEADER': return 'role_team_leader'", LABEL],
    ["app/(dashboard)/dashboard/all-users/page.tsx", "case 'ADMIN': return 'role_admin'", LABEL],

    // app/(dashboard)/dashboard/profile-requests/page.tsx
    ["app/(dashboard)/dashboard/profile-requests/page.tsx", "case 'EMPLOYEE': return 'role_employee'", LABEL],
    ["app/(dashboard)/dashboard/profile-requests/page.tsx", "case 'TEAM_LEADER': return 'role_team_leader'", LABEL],
    ["app/(dashboard)/dashboard/profile-requests/page.tsx", "case 'ADMIN': return 'role_admin'", LABEL],

    // app/(dashboard)/dashboard/clients/[id]/sections/[sectionId]/page.tsx
    ["app/(dashboard)/dashboard/clients/[id]/sections/[sectionId]/page.tsx", "case 'ADMIN':", LABEL],
    ["app/(dashboard)/dashboard/clients/[id]/sections/[sectionId]/page.tsx", "case 'TEAM_LEADER':", LABEL],

    // app/(dashboard)/dashboard/obligations/new/page.tsx
    ["app/(dashboard)/dashboard/obligations/new/page.tsx", "? sortedData.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role))", THE_PERSON],

    // app/(dashboard)/dashboard/obligations/[id]/client.tsx
    ["app/(dashboard)/dashboard/obligations/[id]/client.tsx", "const filtered = canManage && !companyWide('obligations.manage') ? usersList.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role)) : usersList", THE_PERSON],

    // lib/services/task.service.ts
    ["lib/services/task.service.ts", "if (targetUsers.some(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))) {", THE_PERSON],

    // lib/services/assignee-guard.ts
    ["lib/services/assignee-guard.ts", "if (assignees.some(a => [\"ADMIN\", \"SUPER_ADMIN\"].includes(a.role))) {", THE_PERSON],

    // lib/services/employment.service.ts
    ["lib/services/employment.service.ts", "const released = next === \"ARCHIVED\" && user.role === \"TEAM_LEADER\"", THE_PERSON],

    // lib/services/role-assignment.service.ts — rule 8: a company keeps someone at work on its built-in Admin role
    ["lib/services/role-assignment.service.ts", "if (!user?.roleId || user.assignedRole?.builtIn !== \"ADMIN\") return", ADMIN_ROLE],

    // lib/services/user.service.ts
    ["lib/services/user.service.ts", "if ((newUserRole === 'ADMIN' || newUserRole === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {", ADMIN_ROLE],
    ["lib/services/user.service.ts", "if (isSelf && regularUser && ['EMPLOYEE', 'TEAM_LEADER'].includes(regularUser.role)) {", THE_PERSON],
    ["lib/services/user.service.ts", "if (['ADMIN', 'SUPER_ADMIN'].includes(targetRole) && !isSelf && userRole === 'SUPER_ADMIN') {", ADMIN_ROLE],
    ["lib/services/user.service.ts", "if ((role === 'ADMIN' || role === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {", ADMIN_ROLE],
    ["lib/services/user.service.ts", "if (user.role === 'ADMIN' && requesterRole !== 'SUPER_ADMIN') throw new Error(\"FORBIDDEN\")", ADMIN_ROLE],

    // lib/team-assignment.ts
    ["lib/team-assignment.ts", "if (target.role !== \"EMPLOYEE\") {", THE_PERSON],
    ["lib/team-assignment.ts", "if (leader.role !== \"TEAM_LEADER\") {", THE_PERSON],
    ["lib/team-assignment.ts", "return nextRole !== \"EMPLOYEE\"", THE_PERSON],
    ["lib/team-assignment.ts", "if (current.role !== \"TEAM_LEADER\") return false", THE_PERSON],
    ["lib/team-assignment.ts", "if (next.role !== undefined && next.role !== \"TEAM_LEADER\") return true", THE_PERSON],

    // lib/billing/state.ts
    ["lib/billing/state.ts", "if (role === 'SUPER_ADMIN' || role === 'ADMIN') return false", ADMIN_ROLE],

    // components/EmployeeFilter.tsx
    ["components/EmployeeFilter.tsx", ".filter(emp => emp.role !== 'ADMIN' && emp.role !== 'SUPER_ADMIN')", THE_PERSON],
    ["components/EmployeeFilter.tsx", "case 'EMPLOYEE': return 'role_employee'", LABEL],
    ["components/EmployeeFilter.tsx", "case 'TEAM_LEADER': return 'role_team_leader'", LABEL],
    ["components/EmployeeFilter.tsx", "case 'ADMIN': return 'role_admin'", LABEL],

    // components/DashboardHeader.tsx
    ["components/DashboardHeader.tsx", "case 'EMPLOYEE': return 'role_employee'", LABEL],
    ["components/DashboardHeader.tsx", "case 'TEAM_LEADER': return 'role_team_leader'", LABEL],
    ["components/DashboardHeader.tsx", "case 'ADMIN': return 'role_admin'", LABEL],
    ["components/DashboardHeader.tsx", "{!['ADMIN', 'SUPER_ADMIN'].includes(currentUser.role) && (", ADMIN_ROLE],

    // components/EmployeeProfileForm.tsx
    ["components/EmployeeProfileForm.tsx", "if (userId === sessionUserId && (employee.role === 'EMPLOYEE' || employee.role === 'TEAM_LEADER')) {", THE_PERSON],
    ["components/EmployeeProfileForm.tsx", "const isRestrictedRole = role === 'EMPLOYEE' || role === 'TEAM_LEADER'", THE_PERSON],
    ["components/EmployeeProfileForm.tsx", "teamLeaderId: canAssignTeam && userId !== session?.user?.id && role === 'EMPLOYEE'", THE_PERSON],
    ["components/EmployeeProfileForm.tsx", "(can('salary.view') || userId === session?.user?.id) && !['ADMIN', 'SUPER_ADMIN'].includes(role) && role !== '' && (", THE_PERSON],
    ["components/EmployeeProfileForm.tsx", "(can('dayoff.view') || userId === session?.user?.id) && !['ADMIN', 'SUPER_ADMIN'].includes(role) && role !== '' && (", THE_PERSON],
    ["components/EmployeeProfileForm.tsx", "{(userRole === 'SUPER_ADMIN' || role === 'ADMIN') && <option value=\"ADMIN\">{t('role_admin')}</option>}", ADMIN_ROLE],
    ["components/EmployeeProfileForm.tsx", "userId === session?.user?.id && role === 'EMPLOYEE' && (", THE_PERSON],
    ["components/EmployeeProfileForm.tsx", "&& role === 'EMPLOYEE' && (", THE_PERSON],
]

const ROLE_CHECK = /(===?|!==?)\s*['"](ADMIN|TEAM_LEADER|EMPLOYEE)['"]|['"](ADMIN|TEAM_LEADER|EMPLOYEE)['"]\s*(===?|!==?)|\[[^\]]*['"](ADMIN|TEAM_LEADER|EMPLOYEE)['"][^\]]*\]\s*\.includes|case\s+['"](ADMIN|TEAM_LEADER|EMPLOYEE)['"]/

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$|harness/.test(entry)) out.push(full)
    }
    return out
}

/** Where the built-in roles are defined — the one place that names them by design. */
const EXEMPT_DIR = "lib/permissions/"

function roleChecks(): [file: string, line: string][] {
    const found: [string, string][] = []
    for (const file of ["app", "lib", "components", "context"].flatMap(dir => walk(dir))) {
        if (file.startsWith(EXEMPT_DIR)) continue
        for (const line of stripComments(readFileSync(file, "utf8")).split("\n")) {
            if (ROLE_CHECK.test(line)) found.push([file, line.trim()])
        }
    }
    return found
}

describe("access is decided by permission, not by role name", () => {
    const found = roleChecks()
    const key = ([file, line]: [string, string]) => `${file}: ${line}`
    const allowed = ALLOWED.map(([file, line]) => key([file, line]))

    // Counted, not just matched: a listed line copied somewhere else in the same
    // file is a new check, and must be looked at like one.
    const tally = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())
    const foundCount = tally(found.map(key))
    const allowedCount = tally(allowed)

    it("has no role check that is not listed with its reason", () => {
        const unlisted = [...foundCount].filter(([k, n]) => n > (allowedCount.get(k) ?? 0)).map(([k]) => k)
        expect(unlisted, "Ask can() / useCan() / grantFor() instead — or, if this is about the person acted on, a label, or the locked Admin role, add it to ALLOWED with the reason").toEqual([])
    })

    it("lists nothing that is no longer there", () => {
        const stale = [...allowedCount].filter(([k, n]) => n > (foundCount.get(k) ?? 0)).map(([k]) => k)
        expect(stale, "remove these from ALLOWED").toEqual([])
    })

    it("gives every listed check a reason", () => {
        for (const [, , why] of ALLOWED) expect([LABEL, THE_PERSON, ADMIN_ROLE, SYSTEM_JOB]).toContain(why)
    })
})
