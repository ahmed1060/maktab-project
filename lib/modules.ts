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

import type { TranslationKey } from '@/lib/translations'

export const MODULE_KEYS = [
    'dashboard',
    'tasks',
    'obligations',
    'requests',
    'dayOff',
    'records',
    'costs',
    'employees',
    'clients',
    'locations',
] as const

export type ModuleKey = (typeof MODULE_KEYS)[number]

export function isModuleKey(value: unknown): value is ModuleKey {
    return typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value)
}

type ModuleDefinition = {
    /**
     * Translation key for the built-in name, in both locales. Typed as
     * TranslationKey rather than string so a key that does not exist in the
     * dictionary fails typecheck here, instead of rendering the raw key as a
     * sidebar entry.
     */
    labelKey: TranslationKey
    /** The emoji shown when a company has not chosen its own. */
    icon: string
    /** Where the sidebar entry points, and the prefix its pages live under. */
    href: string
}

/**
 * Defaults, read off the sidebar as it stands today, so an uncustomised
 * company is byte-identical to before this existed.
 *
 * One of these settles an inconsistency rather than recording one: Day Off is
 * 📅 in the sidebar and 🌴 on its page. Nobody has complained, but a module
 * cannot have two icons once there is one place that answers what its icon is
 * — so the sidebar value wins and the pages will follow it.
 *
 * Records is today's Clients section, moved onto each client's page
 * (CLIENTS_PLAN.md §0.2). Its key changed with it, and a company's own name or
 * icon for it moved to the new key in the same migration.
 */
export const MODULES: Record<ModuleKey, ModuleDefinition> = {
    dashboard: { labelKey: 'dashboard', icon: '📊', href: '/dashboard' },
    tasks: { labelKey: 'tasks', icon: '✅', href: '/dashboard/tasks' },
    obligations: { labelKey: 'obligations', icon: '📌', href: '/dashboard/obligations' },
    requests: { labelKey: 'requests', icon: '📩', href: '/dashboard/requests' },
    dayOff: { labelKey: 'day_off_requests', icon: '📅', href: '/dashboard/day-off-requests' },
    records: { labelKey: 'records', icon: '🗂️', href: '/dashboard/records' },
    costs: { labelKey: 'costs', icon: '💰', href: '/dashboard/costs' },
    employees: { labelKey: 'employees', icon: '👥', href: '/dashboard/employees' },
    clients: { labelKey: 'clients', icon: '🚚', href: '/dashboard/clients' },
    // The places tasks happen at (CLIENTS_PLAN.md §2).
    locations: { labelKey: 'locations', icon: '🗺️', href: '/dashboard/locations' },
}

/** A company's overrides, by module. A missing key falls through to the default. */
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

/**
 * The longest a custom label may be. The same cap the old `vendorsLabel`
 * column carried: a sidebar entry that wraps to three lines is a worse
 * outcome than a rejected rename.
 */
export const MAX_MODULE_LABEL_LENGTH = 50

/**
 * Whether a string is usable as a module's icon.
 *
 * The icon is rendered at 1.4rem in a sidebar row and at 5xl on an empty
 * state, so it has to be one glyph-ish thing rather than a word. Three
 * conditions, each guarding a different way the picker can be bypassed (the
 * API accepts JSON, not only what the UI sends):
 *
 *   - an upper bound in code units, because a ZWJ sequence like 👨‍👩‍👧‍👦 is
 *     eleven of them and a pasted paragraph is thousands;
 *   - no whitespace, which is what stops "🚚 trucks" and "a b";
 *   - at least one pictographic character, which is what stops "AB" and "…".
 *
 * Regional indicators are allowed alongside pictographs because a flag is two
 * of them and neither is Extended_Pictographic — 🇪🇬 would otherwise be
 * rejected, which for this app's customers is the wrong emoji to refuse.
 *
 * Deliberately not "exactly one grapheme": Intl.Segmenter is the only correct
 * way to count those, it is not available in every runtime this code runs in,
 * and the failure it would additionally catch (two emoji in one slot) is
 * cosmetic and self-evident to whoever typed it.
 */
export function isValidModuleIcon(value: string): boolean {
    if (value.length === 0 || value.length > 16) return false
    if (/\s/u.test(value)) return false
    return /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(value)
}

/** Narrows a Json icon map, dropping anything that is not a usable icon. */
export function parseModuleIcons(value: unknown): ModuleOverrides {
    const out = parseModuleOverrides(value)
    for (const key of Object.keys(out) as ModuleKey[]) {
        if (!isValidModuleIcon(out[key] as string)) delete out[key]
    }
    return out
}

/**
 * This company's name for a module: its override, or the built-in translation.
 *
 * `t` is passed in rather than imported because the translation function is a
 * React context value on the client and a locale-bound closure on the server,
 * and this file is neither.
 */
export function resolveModuleLabel(
    key: ModuleKey,
    overrides: ModuleOverrides | null | undefined,
    t: (key: TranslationKey) => string
): string {
    const custom = overrides?.[key]
    // `|| t(...)` rather than `??`: parseModuleOverrides already drops empty
    // strings, but this is also called with maps that have not been through it.
    return custom || t(MODULES[key].labelKey)
}

/** This company's icon for a module, or the built-in one. */
export function resolveModuleIcon(key: ModuleKey, overrides: ModuleOverrides | null | undefined): string {
    return overrides?.[key] || MODULES[key].icon
}

// labelKey → module, built once. Every labelKey is distinct, which the test
// asserts rather than assumes: two modules sharing one would make this map
// silently answer with whichever was declared last.
const BY_LABEL_KEY: ReadonlyMap<string, ModuleKey> = new Map(
    MODULE_KEYS.map((key) => [MODULES[key].labelKey, key] as const)
)

/**
 * The module a translation key names, if any.
 *
 * The bridge between the route→title-key table in lib/page-title.ts (which is
 * about tab titles and covers System pages too) and this registry (which is
 * about renameable modules). Anything unmatched — "history", "audit_logs" — is
 * not a module and keeps its translated name.
 */
export function moduleForTitleKey(titleKey: string | null | undefined): ModuleKey | null {
    if (!titleKey) return null
    return BY_LABEL_KEY.get(titleKey) ?? null
}

/** How the side bar groups these, with the app's own pages, is lib/side-bar.ts. */

/**
 * The resolvers, bound to one company's overrides.
 *
 * Takes the session user rather than a Company row, because that is where the
 * overrides already are on both sides of the app: lib/auth.ts stamps them onto
 * the token, so a Server Component reads them off getServerSession and a Client
 * Component off useSession, with no query either way. The two halves of the
 * dashboard therefore cannot disagree about what a module is called.
 *
 * `lib/useModules.ts` is the client-side wrapper that memoizes this against the
 * session; Server Components call it directly with their own `t`.
 */
export function modulesFrom(
    user: { moduleLabels?: unknown; moduleIcons?: unknown } | null | undefined,
    t: (key: TranslationKey) => string
) {
    const labels = parseModuleOverrides(user?.moduleLabels)
    const icons = parseModuleIcons(user?.moduleIcons)
    return {
        /** The display name for a module, translated or overridden. */
        label: (key: ModuleKey) => resolveModuleLabel(key, labels, t),
        /** The emoji for a module, default or overridden. */
        icon: (key: ModuleKey) => resolveModuleIcon(key, icons),
        /** Both at once plus the href, for a nav row. */
        entry: (key: ModuleKey) => ({
            key,
            href: MODULES[key].href,
            label: resolveModuleLabel(key, labels, t),
            icon: resolveModuleIcon(key, icons),
        }),
        labels,
        icons,
    }
}

export type ResolvedModules = ReturnType<typeof modulesFrom>

/**
 * An override map with nothing in it is not an empty map, it is no overrides —
 * so it is stored as NULL. A company that cleared every rename then reads back
 * identical to one that never renamed anything, which is what keeps "is this
 * company customised?" a question about the data rather than about its history.
 */
export function emptyToNull(overrides: ModuleOverrides): ModuleOverrides | null {
    return Object.keys(overrides).length > 0 ? overrides : null
}

/** Whether two override maps say the same thing. Order-insensitive. */
export function sameOverrides(
    a: ModuleOverrides | null | undefined,
    b: ModuleOverrides | null | undefined
): boolean {
    const left = a ?? {}
    const right = b ?? {}
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
        if (left[key as ModuleKey] !== right[key as ModuleKey]) return false
    }
    return true
}

/**
 * What a company update should store for one of the two override maps.
 *
 * Three cases, and the whole reason this is a named function is that two of
 * them look alike and mean opposite things:
 *
 *   - `undefined` — this update is not about these overrides. Leave the column
 *     as it is.
 *   - `null` — clear every override. Reset.
 *   - a map — replace what is stored with it, wholesale. The settings form
 *     holds all nine modules and posts all nine, so a key absent from the
 *     payload was cleared, not left alone.
 *
 * Labels and icons differ only in how they are narrowed, which is what `kind`
 * selects: an icon that is not an emoji is dropped, a label is kept as typed.
 * They were asymmetric until the contract step, because labels also had to keep
 * the old `vendorsLabel` column in step with `moduleLabels.vendors`. That column
 * is gone, and with it the only merge this ever did.
 */
export function planOverrideWrite(
    incoming: Record<string, string> | null | undefined,
    kind: "labels" | "icons"
): ModuleOverrides | null | undefined {
    if (incoming === undefined) return undefined
    if (incoming === null) return null
    const parse = kind === "icons" ? parseModuleIcons : parseModuleOverrides
    return emptyToNull(parse(incoming))
}
