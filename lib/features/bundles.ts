/**
 * What each bundle contains, and how a company's package resolves into a set of
 * permissions.
 *
 * Pure data and pure functions: no Prisma, no session, no React. The callers
 * differ wildly — a nav item, an API route, a button — and they must all be
 * asking the same question of the same table.
 */

export type Bundle = 'COMPANY_MANAGEMENT' | 'HR'

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

/**
 * The single table. A module maps to the bundle that owns it, or to null when it
 * is Core.
 *
 * Everything that is not listed here is Core by omission — which is the wrong
 * default for a gate, so `MODULE_BUNDLE` lists every module explicitly and
 * `isModule()` below is what decides whether a name is known at all.
 */
export const MODULE_BUNDLE: Record<Module, Bundle | null> = {
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
    bundles: new Set<Bundle>(['COMPANY_MANAGEMENT', 'HR']),
}

/**
 * A company's package, as far as this module cares.
 *
 * Null means grandfathered — everything on, no limits. Every company that
 * existed before packages shipped resolves this way, and stays that way until
 * somebody deliberately assigns one.
 */
export type PackageFacts = { hasCompanyManagement: boolean; hasHR: boolean } | null | undefined

export function resolveBundles(pkg: PackageFacts, { isSuperAdmin = false } = {}): FeatureAccess {
    // Super Admin is never gated. They administer the packages; gating them out
    // of a module would lock the person who sells it out of demonstrating it.
    if (isSuperAdmin) return UNRESTRICTED
    if (!pkg) return UNRESTRICTED

    const bundles = new Set<Bundle>()
    if (pkg.hasCompanyManagement) bundles.add('COMPANY_MANAGEMENT')
    if (pkg.hasHR) bundles.add('HR')
    return { unrestricted: false, bundles }
}

/** Whether a company may use a module at all. Core modules are always allowed. */
export function hasModule(access: FeatureAccess, module: Module): boolean {
    if (access.unrestricted) return true
    const required = MODULE_BUNDLE[module]
    return required === null || access.bundles.has(required)
}

export function hasBundle(access: FeatureAccess, bundle: Bundle): boolean {
    return access.unrestricted || access.bundles.has(bundle)
}

/** The bundle a module belongs to, for an upgrade prompt naming what to buy. */
export function bundleFor(module: Module): Bundle | null {
    return MODULE_BUNDLE[module]
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
