import { type Module } from "./bundles"

/**
 * Which module each API path belongs to.
 *
 * One table, consulted by one check in withStandardHandler. The alternative —
 * a requireFeature call in each of sixty route files — is how gating rots: the
 * sixty-first route gets added without one and nobody notices, because nothing
 * fails.
 *
 * Only paths that belong to a gated module need an entry. Anything unlisted is
 * Core and ungated, which is the safe direction to be wrong in: a missed entry
 * leaves a feature open rather than locking a paying customer out of something
 * they bought.
 */
const API_MODULE_ROUTES: ReadonlyArray<readonly [string, Module]> = [
    // --- Company Management ---
    ['/api/tasks', 'TASKS'],
    ['/api/templates', 'TASKS'],          // the bulk-upload template is a Tasks feature
    ['/api/obligations', 'OBLIGATIONS'],
    ['/api/clients', 'CLIENTS'],
    ['/api/vendors', 'VENDORS'],

    // --- HR ---
    ['/api/day-off-requests', 'DAY_OFF'],
    ['/api/admin/day-off-requests', 'DAY_OFF'],
] as const

/**
 * Per-path-and-method entries, for endpoints under a Core or
 * Company-Management path that actually belong to another bundle.
 *
 * These are the crossings the plan calls out: a Tasks feature writing into
 * payroll, or a people-shaped endpoint living under /api/users. Listed
 * explicitly rather than folded into the prefixes above, because prefix
 * matching cannot express "this one child of /api/users is HR while its
 * siblings are Core".
 */
const API_MODULE_PATTERNS: ReadonlyArray<readonly [RegExp, Module]> = [
    // The penalty on a task: a Tasks feature that reads, updates and creates a
    // SalaryRecord — an operations action writing into payroll. Listed before
    // the /api/tasks prefix so it resolves to HR rather than to Tasks, which a
    // Company-Management-only company does hold. The automated payroll
    // machinery behind it keeps running; only this manual action is gated.
    [/^\/api\/tasks\/[^/]+\/penalty$/, 'SALARY_ADJUSTMENTS'],
    // Bonuses, deductions and their rollback: HR money, reached from the
    // employee directory, which is Core.
    [/^\/api\/users\/[^/]+\/(bonus|deduction|adjustments)(\/|$)/, 'SALARY_ADJUSTMENTS'],
    // Salary and cost history: the record of HR money.
    [/^\/api\/users\/[^/]+\/(salary-history|costs-history)$/, 'PAYROLL'],
    // Leave history belongs with leave.
    [/^\/api\/users\/[^/]+\/day-off-history$/, 'DAY_OFF'],
    // Task costs and payment tracking — Company Management, under /api/tasks
    // already, but named here so the intent is recorded rather than inherited.
    [/^\/api\/tasks\/payment(\/|$)/, 'COSTS'],
] as const

// Longest prefix first, so a more specific path is never swallowed by a shorter
// one that happens to share its opening.
const BY_SPECIFICITY = [...API_MODULE_ROUTES].sort((a, b) => b[0].length - a[0].length)

/**
 * The module an API path belongs to, or null when it is Core and ungated.
 * Patterns are consulted first: they exist precisely to override the prefixes.
 */
export function moduleForApiPath(pathname: string): Module | null {
    for (const [pattern, module] of API_MODULE_PATTERNS) {
        if (pattern.test(pathname)) return module
    }
    for (const [prefix, module] of BY_SPECIFICITY) {
        if (pathname === prefix || pathname.startsWith(prefix + '/')) return module
    }
    return null
}

/**
 * Which module a dashboard page belongs to. Separate table from the API one:
 * the URL spaces are different, and conflating them would mean a page path
 * accidentally matching an API prefix.
 */
const PAGE_MODULE_ROUTES: ReadonlyArray<readonly [string, Module]> = [
    ['/dashboard/tasks', 'TASKS'],
    ['/dashboard/obligations', 'OBLIGATIONS'],
    ['/dashboard/clients', 'CLIENTS'],
    ['/dashboard/vendors', 'VENDORS'],
    ['/dashboard/costs', 'COSTS'],
    ['/dashboard/day-off-requests', 'DAY_OFF'],
] as const

const PAGES_BY_SPECIFICITY = [...PAGE_MODULE_ROUTES].sort((a, b) => b[0].length - a[0].length)

export function moduleForPagePath(pathname: string): Module | null {
    const match = PAGES_BY_SPECIFICITY.find(
        ([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/')
    )
    return match ? match[1] : null
}
