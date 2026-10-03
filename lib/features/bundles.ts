/**
 * What each bundle contains, and how a company's package resolves into a set of
 * permissions.
 *
 * Pure data and pure functions: no Prisma, no session, no React. The callers
 * differ wildly — a nav item, an API route, a button — and they must all be
 * asking the same question of the same table.
 */

export type Bundle = 'COMPANY_MANAGEMENT' | 'HR' | 'ATTENDANCE_TERMINALS' | 'ATTENDANCE_MOBILE'

/**
 * The two attendance add-ons (ATTENDANCE_PLAN.md §16): how punches arrive —
 * fingerprint terminals, or the phone app. Sold one or both, and only on top
 * of HR, because attendance feeds payroll.
 */
export const ATTENDANCE_BUNDLES = ['ATTENDANCE_TERMINALS', 'ATTENDANCE_MOBILE'] as const satisfies readonly Bundle[]

/**
 * A module is a nameable area of the product. Core modules belong to no bundle
 * and are never gated: without the employee directory a Company-Management-only
 * buyer would have nobody to assign a task to, and without accounts, requests
 * and notifications there would be no product at all.
 */
export type Module =
    | 'DASHBOARD' | 'EMPLOYEES' | 'USERNAMES' | 'PROFILE_REQUESTS' | 'REQUESTS'
    | 'TASKS' | 'OBLIGATIONS' | 'CLIENTS' | 'VENDORS' | 'COSTS'
    | 'DAY_OFF' | 'PAYROLL' | 'SALARY_ADJUSTMENTS'
    | 'ATTENDANCE'

/**
 * The single table. A module maps to the bundle that owns it, to a list of
 * bundles any one of which opens it, or to null when it is Core.
 *
 * Everything that is not listed here is Core by omission — which is the wrong
 * default for a gate, so `MODULE_BUNDLE` lists every module explicitly and
 * `isModule()` below is what decides whether a name is known at all.
 */
export const MODULE_BUNDLE: Record<Module, Bundle | readonly Bundle[] | null> = {
    // Core — always on, never sold.
    DASHBOARD: null,
    EMPLOYEES: null,          // the directory itself; their leave and pay are HR
    USERNAMES: null,
    PROFILE_REQUESTS: null,
    REQUESTS: null,           // internal requests and performance points

    // Company Management — what the business does and what it costs.
    TASKS: 'COMPANY_MANAGEMENT',
    OBLIGATIONS: 'COMPANY_MANAGEMENT',
    CLIENTS: 'COMPANY_MANAGEMENT',
    VENDORS: 'COMPANY_MANAGEMENT',
    COSTS: 'COMPANY_MANAGEMENT',

    // HR — time, money, and the record of both.
    DAY_OFF: 'HR',
    PAYROLL: 'HR',
    SALARY_ADJUSTMENTS: 'HR',

    // Attendance — schedules, policy, the engine, import and the screens on
    // them. Needed however punches arrive, so either add-on opens it (§16);
    // there is no attendance without one of them.
    ATTENDANCE: ATTENDANCE_BUNDLES,
}

/** Each bundle's name, as a translation key, for every screen that names one. */
export const BUNDLE_LABEL_KEYS: Record<Bundle, string> = {
    COMPANY_MANAGEMENT: 'bundle_company_management',
    HR: 'bundle_hr',
    ATTENDANCE_TERMINALS: 'bundle_attendance_terminals',
    ATTENDANCE_MOBILE: 'bundle_attendance_mobile',
}

/** The same names in English, for API messages, which are not translated. */
export const BUNDLE_NAMES: Record<Bundle, string> = {
    COMPANY_MANAGEMENT: 'Company Management',
    HR: 'HR',
    ATTENDANCE_TERMINALS: 'Attendance — Terminals',
    ATTENDANCE_MOBILE: 'Attendance — Mobile App',
}

export const ALL_MODULES = Object.keys(MODULE_BUNDLE) as Module[]

export function isModule(value: string): value is Module {
    return Object.prototype.hasOwnProperty.call(MODULE_BUNDLE, value)
}

/**
 * What a company holds. Assembled from its package by `resolveBundles`.
 *
 * `unrestricted` is not "holds both bundles" — it is the grandfathered and
 * Super Admin case, where no gate applies at all. Kept distinct so a screen can
 * tell "this customer bought everything" from "this customer was never
 * packaged", which are the same permissions and very different facts.
 */
export type FeatureAccess = {
    unrestricted: boolean
    bundles: Set<Bundle>
}

export const UNRESTRICTED: FeatureAccess = {
    unrestricted: true,
    bundles: new Set<Bundle>(['COMPANY_MANAGEMENT', 'HR', ...ATTENDANCE_BUNDLES]),
}

/**
 * A company's package, as far as this module cares.
 *
 * Null means grandfathered — everything on, no limits. Every company that
 * existed before packages shipped resolves this way, and stays that way until
 * somebody deliberately assigns one.
 */
export type PackageFacts = {
    hasCompanyManagement: boolean
    hasHR: boolean
    // Optional so a caller that selects only the first two still type-checks;
    // absent reads as not bought.
    hasAttendanceTerminals?: boolean
    hasAttendanceMobile?: boolean
} | null | undefined

export function resolveBundles(pkg: PackageFacts, { isSuperAdmin = false } = {}): FeatureAccess {
    // Super Admin is never gated. They administer the packages; gating them out
    // of a module would lock the person who sells it out of demonstrating it.
    if (isSuperAdmin) return UNRESTRICTED
    if (!pkg) return UNRESTRICTED

    const bundles = new Set<Bundle>()
    if (pkg.hasCompanyManagement) bundles.add('COMPANY_MANAGEMENT')
    if (pkg.hasHR) bundles.add('HR')
    // Only on top of HR. The package form refuses either without it and
    // removing HR removes both, so this is the last line, not the only one: a
    // row edited by hand must not open attendance with no payroll under it.
    if (pkg.hasHR && pkg.hasAttendanceTerminals) bundles.add('ATTENDANCE_TERMINALS')
    if (pkg.hasHR && pkg.hasAttendanceMobile) bundles.add('ATTENDANCE_MOBILE')
    return { unrestricted: false, bundles }
}

/** Whether a company may use a module at all. Core modules are always allowed. */
export function hasModule(access: FeatureAccess, module: Module): boolean {
    if (access.unrestricted) return true
    return bundlesFor(module).length === 0 || bundlesFor(module).some(b => access.bundles.has(b))
}

export function hasBundle(access: FeatureAccess, bundle: Bundle): boolean {
    return access.unrestricted || access.bundles.has(bundle)
}

/**
 * The bundles that open a module, for an upgrade prompt naming what to buy:
 * empty for Core, one for most, and any of several for attendance.
 */
export function bundlesFor(module: Module): readonly Bundle[] {
    const required = MODULE_BUNDLE[module]
    if (required === null) return []
    return typeof required === 'string' ? [required] : required
}

/**
 * Serialised for the session token — a Set does not survive JSON, and the token
 * is where this has to travel.
 */
export type SerializedAccess = { unrestricted: boolean; bundles: Bundle[] }

export function serializeAccess(access: FeatureAccess): SerializedAccess {
    return { unrestricted: access.unrestricted, bundles: [...access.bundles] }
}

export function deserializeAccess(value: SerializedAccess | null | undefined): FeatureAccess {
    // A token minted before this shipped carries nothing here. Falling back to
    // unrestricted is deliberate: the alternative is that everybody signed in at
    // deploy time abruptly loses every gated module until their token refreshes.
    if (!value) return UNRESTRICTED
    return { unrestricted: value.unrestricted, bundles: new Set(value.bundles) }
}
