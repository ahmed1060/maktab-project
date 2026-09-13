/**
 * Route → browser tab title.
 *
 * Kept as plain data and pure functions, separate from the component that
 * applies them, so the mapping can be tested without React: the failure this
 * guards against is a route pointed at a translation key that does not exist,
 * which puts the raw key in the tab ("Nizmo — email_settings") and is invisible
 * to typecheck and build because the key is just a string.
 */

export const APP_NAME = "Nizmo"

// Keyed by route prefix, valued by translation key. Only sections with a name
// worth showing; anything unmatched falls back to the bare app name rather than
// inventing a label out of the URL.
export const ROUTE_TITLE_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["/dashboard/tasks", "tasks"],
    ["/dashboard/obligations", "obligations"],
    ["/dashboard/requests/history", "history"],
    ["/dashboard/requests", "requests"],
    ["/dashboard/day-off-requests", "day_off_requests"],
    ["/dashboard/clients", "clients"],
    ["/dashboard/costs", "costs"],
    ["/dashboard/employees", "employees"],
    ["/dashboard/vendors", "vendors"],
    ["/dashboard/super-admins", "super_admins"],
    ["/dashboard/companies", "companies"],
    ["/dashboard/packages", "packages"],
    ["/dashboard/all-users", "all_users"],
    ["/dashboard/audit-logs", "audit_logs"],
    ["/dashboard/health", "system_health"],
    ["/dashboard/system-settings", "system_settings"],
    ["/dashboard/email-settings", "email_settings_nav"],
    ["/dashboard/mfa-settings", "mfa_settings_nav"],
    ["/dashboard/profile-requests", "profile_requests"],
    ["/dashboard/usernames", "view_usernames"],
    ["/dashboard/maintenance", "maintenance_mode_header"],
    ["/dashboard", "dashboard"],
] as const

// Sorted once at module load rather than per navigation. Longest prefix wins, so
// /requests/history is not swallowed by /requests, and /dashboard does not
// swallow any of its children.
const BY_SPECIFICITY = [...ROUTE_TITLE_KEYS].sort((a, b) => b[0].length - a[0].length)

export function resolveTitleKey(pathname: string): string | null {
    // Whole-segment match only: /dashboard/taskspecial is not the tasks page.
    const match = BY_SPECIFICITY.find(
        ([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/")
    )
    return match ? match[1] : null
}

export function buildTitle(section: string | null): string {
    return section ? `${APP_NAME} — ${section}` : APP_NAME
}
