import type { ModuleKey } from './modules'
import type { Permission } from './permissions/catalogue'
import type { TranslationKey } from './translations'

/**
 * The side bar's groups (UI_PLAN.md §2.1, §2.2): grouped by what people do,
 * each item shown only to those who may use it, and a group hidden when
 * nothing in it is.
 *
 * Here rather than in DashboardShell because the Company Settings screen
 * draws a preview of the side bar (CompanyModulesCard), and two files
 * deciding the order apart is how a preview stops matching what it shows.
 */

/** One of the app's own pages, which a company can't rename, unlike its modules (lib/modules.ts). */
type PageKey =
    | 'checkIn' | 'attendance' | 'myAttendance' | 'roleRequests' | 'profileRequests' | 'payroll' | 'myPayslips' | 'companySettings' | 'savedLists'
    | 'companies' | 'packages' | 'allUsers'
    | 'roleTemplates' | 'policyTemplates' | 'publicHolidays'
    | 'superAdmins' | 'roleChanges' | 'accessReviews' | 'whoCan'
    | 'checkIns' | 'auditLogs' | 'systemHealth' | 'systemSettings'

export type SideBarItemKey = ModuleKey | PageKey

/** The app's own pages: where each goes, its name and its icon. */
export const PAGES: Record<PageKey, { href: string; labelKey: TranslationKey; icon: string }> = {
    checkIn: { href: '/dashboard/check-in', labelKey: 'ci_title', icon: '📲' },
    attendance: { href: '/dashboard/attendance', labelKey: 'attendance_title', icon: '🕘' },
    // The same page, for someone who sees only their own punches on it.
    myAttendance: { href: '/dashboard/attendance', labelKey: 'my_attendance', icon: '🕘' },
    roleRequests: { href: '/dashboard/role-requests', labelKey: 'role_requests_title', icon: '🪪' },
    profileRequests: { href: '/dashboard/profile-requests', labelKey: 'nav_profile_requests', icon: '📝' },
    payroll: { href: '/dashboard/payroll', labelKey: 'payroll', icon: '🧾' },
    myPayslips: { href: '/dashboard/documents', labelKey: 'my_payslips', icon: '📄' },
    companySettings: { href: '/dashboard/settings', labelKey: 'company_settings_title', icon: '⚙️' },
    // The saved lists of cost names and task titles (CLIENTS_PLAN.md §5.6).
    savedLists: { href: '/dashboard/lists', labelKey: 'saved_lists_title', icon: '📋' },
    companies: { href: '/dashboard/companies', labelKey: 'companies', icon: '🏢' },
    packages: { href: '/dashboard/packages', labelKey: 'packages', icon: '📦' },
    allUsers: { href: '/dashboard/all-users', labelKey: 'all_users', icon: '👥' },
    roleTemplates: { href: '/dashboard/role-templates', labelKey: 'role_templates_title', icon: '🧩' },
    policyTemplates: { href: '/dashboard/policy-templates', labelKey: 'ptpl_title', icon: '⏱️' },
    publicHolidays: { href: '/dashboard/public-holidays', labelKey: 'public_holidays_title', icon: '🗓️' },
    superAdmins: { href: '/dashboard/super-admins', labelKey: 'super_admins', icon: '🛡️' },
    roleChanges: { href: '/dashboard/role-change-requests', labelKey: 'role_changes_title', icon: '📨' },
    accessReviews: { href: '/dashboard/access-reviews', labelKey: 'access_review_title', icon: '🗂️' },
    whoCan: { href: '/dashboard/who-can', labelKey: 'who_can_title', icon: '🔎' },
    checkIns: { href: '/dashboard/check-ins', labelKey: 'chk_title', icon: '📍' },
    auditLogs: { href: '/dashboard/audit-logs', labelKey: 'audit_logs', icon: '📜' },
    systemHealth: { href: '/dashboard/health', labelKey: 'system_health', icon: '❤️' },
    systemSettings: { href: '/dashboard/system-settings', labelKey: 'system_settings', icon: '⚙️' },
}

export type SideBarGroup = {
    key: string
    /** Its name above it; none for the items at the top and at the bottom. */
    labelKey: TranslationKey | null
    items: SideBarItemKey[]
}

/** A company's people's side bar (§2.1), in order. My cash advance joins when it's built. */
export const COMPANY_GROUPS: readonly SideBarGroup[] = [
    { key: 'top', labelKey: null, items: ['dashboard', 'checkIn'] },
    { key: 'work', labelKey: 'nav_group_work', items: ['tasks', 'obligations'] },
    { key: 'clients', labelKey: 'nav_group_clients', items: ['clients', 'locations', 'records'] },
    // The request pages sit together here until the one Requests page (§2.3).
    { key: 'people', labelKey: 'nav_group_people', items: ['employees', 'attendance', 'requests', 'dayOff', 'roleRequests', 'profileRequests'] },
    { key: 'money', labelKey: 'nav_group_money', items: ['costs', 'payroll'] },
    { key: 'me', labelKey: 'nav_group_me', items: ['myAttendance', 'myPayslips'] },
    { key: 'bottom', labelKey: null, items: ['companySettings', 'savedLists'] },
]

/** The Super Admin's own pages (§2.2), after the company's. */
export const SUPER_ADMIN_GROUPS: readonly SideBarGroup[] = [
    { key: 'customers', labelKey: 'nav_group_customers', items: ['companies', 'packages', 'allUsers'] },
    { key: 'templates', labelKey: 'nav_group_templates', items: ['roleTemplates', 'policyTemplates', 'publicHolidays'] },
    { key: 'access', labelKey: 'nav_group_access', items: ['superAdmins', 'roleChanges', 'accessReviews', 'whoCan'] },
    { key: 'operations', labelKey: 'nav_group_operations', items: ['checkIns', 'auditLogs', 'systemHealth', 'systemSettings'] },
]

/** What decides who sees which item. */
export type SideBarViewer = {
    superAdmin: boolean
    can: (permission: Permission) => boolean
    companyWide: (permission: Permission) => boolean
    /** The company's package has Attendance. */
    attendance: boolean
    /** Inside the Nizmo app, for a company with the Mobile App add-on: where a phone can check in. */
    checkIn: boolean
    /** This person sees their company's settings (ATTENDANCE_PLAN.md §5.2). */
    companySettings: boolean
}

/**
 * Who is offered each module that not everyone is: the permission its page
 * needs. Everyone else sees the rest of the modules, locked when the package
 * doesn't have them, as the way to find out what else the product does.
 */
export const MODULE_PERMISSION: Partial<Record<ModuleKey, Permission>> = {
    costs: 'tasks.pay',
    employees: 'employees.view',
    clients: 'clients.view',
    locations: 'locations.view',
}

/** Whether this person is shown an item. */
export function shows(key: SideBarItemKey, v: SideBarViewer): boolean {
    // Attendance is everyone's own punches; it's under People for someone who
    // sees other people's too, and theirs alone under Me otherwise (§2.1). A
    // company without it shows it only to those who would run it.
    const attendance = !v.superAdmin && (v.attendance || v.companyWide('attendance.correct'))
    const seesOthersAttendance = v.can('attendance.view_team') || v.can('attendance.correct')
    switch (key) {
        case 'checkIn': return !v.superAdmin && v.checkIn
        case 'attendance': return attendance && seesOthersAttendance
        case 'myAttendance': return attendance && !seesOthersAttendance
        // Role requests are for whoever decides them, and whoever makes them (ROLES_PLAN.md §6.12).
        case 'roleRequests': return !v.superAdmin && (v.can('employees.assign_role') || v.can('employees.request_role'))
        case 'profileRequests': return v.can('profile_requests.review')
        // A Team Leader manages people, not pay.
        case 'payroll': return v.can('payroll.view')
        // The Super Admin is nobody's employee, and has no payslips.
        case 'myPayslips': return !v.superAdmin
        case 'companySettings': return v.companySettings
        // For whoever manages the lists (CLIENTS_PLAN.md §5.7), in a company with Tasks.
        case 'savedLists': return v.can('lists.manage')
    }
    if (key in PAGES) return v.superAdmin
    const permission = MODULE_PERMISSION[key as ModuleKey]
    return permission ? v.can(permission) : true
}

/** The groups this person sees, each with only the items they're shown; a group with none is left out. */
export function sideBarFor(v: SideBarViewer): SideBarGroup[] {
    return [...COMPANY_GROUPS, ...(v.superAdmin ? SUPER_ADMIN_GROUPS : [])]
        .map(group => ({ ...group, items: group.items.filter(key => shows(key, v)) }))
        .filter(group => group.items.length > 0)
}
