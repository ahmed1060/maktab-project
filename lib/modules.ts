/**
 * The nine company-facing modules, their default labels and their default
 * icons.
 *
 * One registry, so that the sidebar, the settings screen that overrides these,
 * and every page heading that prints a module name all read the same list. The
 * alternative is what exists today: nine entries written out in
 * DashboardShell, the same names again on page headings, and one of them
 * (vendors) already renameable through a column nothing else knows about.
 *
 * The six System modules — Super Admins, Companies, Packages, All Users, Audit
 * Logs, System Health, System Settings — are deliberately absent. A company's
 * own users never see them; only a Super Admin does, while looking at many
 * companies at once, so renaming them per company would customise a screen for
 * an audience of one who is looking at everybody.
 */

export const MODULE_KEYS = [
    'dashboard',
    'tasks',
    'obligations',
    'requests',
    'dayOff',
    'clients',
    'costs',
    'employees',
    'vendors',
] as const

export type ModuleKey = (typeof MODULE_KEYS)[number]

export function isModuleKey(value: unknown): value is ModuleKey {
    return typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value)
}

type ModuleDefinition = {
    /** Translation key for the built-in name, in both locales. */
    labelKey: string
    /** The emoji shown when a company has not chosen its own. */
    icon: string
    /** Where the sidebar entry points, and the prefix its pages live under. */
    href: string
}

/**
 * Defaults, read off the sidebar as it stands today, so an uncustomised
 * company is byte-identical to before this existed.
 *
 * Two of these settle an inconsistency rather than record one. Clients is 🤝 in
 * the sidebar but 🏢 on its own empty state, and Day Off is 📅 in the sidebar
 * and 🌴 on its page. Nobody has complained, but a module cannot have two
 * icons once there is one place that answers what its icon is — so the sidebar
 * value wins and the pages will follow it.
 */
export const MODULES: Record<ModuleKey, ModuleDefinition> = {
    dashboard: { labelKey: 'dashboard', icon: '📊', href: '/dashboard' },
    tasks: { labelKey: 'tasks', icon: '✅', href: '/dashboard/tasks' },
    obligations: { labelKey: 'obligations', icon: '📌', href: '/dashboard/obligations' },
    requests: { labelKey: 'requests', icon: '📩', href: '/dashboard/requests' },
    dayOff: { labelKey: 'day_off_requests', icon: '📅', href: '/dashboard/day-off-requests' },
    clients: { labelKey: 'clients', icon: '🤝', href: '/dashboard/clients' },
    costs: { labelKey: 'costs', icon: '💰', href: '/dashboard/costs' },
    employees: { labelKey: 'employees', icon: '👥', href: '/dashboard/employees' },
    vendors: { labelKey: 'vendors', icon: '🚚', href: '/dashboard/vendors' },
}

/** A company's overrides, as stored. A missing key falls through to the default. */
export type ModuleOverrides = Partial<Record<ModuleKey, string>>

/**
 * Narrows whatever came out of a Json column to the shape this module expects.
 *
 * Json is untyped at the database boundary and these maps are edited through a
 * UI, so an unknown key or a non-string value is a real possibility rather than
 * a hypothetical. Anything unrecognised is dropped rather than trusted: the
 * cost is a module showing its default name, which is exactly what an absent
 * override does anyway.
 */
export function parseModuleOverrides(value: unknown): ModuleOverrides {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

    const out: ModuleOverrides = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!isModuleKey(key)) continue
        if (typeof raw !== 'string') continue
        const trimmed = raw.trim()
        // An empty string is not an override, it is the absence of one. Storing
        // it would render a module with no name at all.
        if (trimmed) out[key] = trimmed
    }
    return out
}
