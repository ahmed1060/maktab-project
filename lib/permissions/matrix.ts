import { PERMISSIONS, isReserved, isSplit, requiresOf, type Permission, type Scope } from "./catalogue"
import type { Grants } from "./grants"
import { normalizeGrants, unmetNeeds, type UnmetNeed } from "./grant-rules"
import type { TranslationKey } from "@/lib/translations"

/**
 * The permission matrix (ROLES_PLAN.md §6.3), as data: which rows, in which
 * groups, with which labels, and what ticking one does. Pure, so the role and
 * template editors share it and a test can check it against the catalogue.
 */

/** Rows grouped as a person thinks of the product, in the order shown. */
export const PERMISSION_GROUPS: { key: string; permissions: Permission[] }[] = [
    { key: "employees", permissions: [] },
    { key: "requests", permissions: [] },
    { key: "tasks", permissions: [] },
    { key: "obligations", permissions: [] },
    { key: "clients", permissions: [] },
    { key: "records", permissions: [] },
    { key: "costs", permissions: [] },
    { key: "client_portal", permissions: [] },
    { key: "dayoff", permissions: [] },
    { key: "salaries", permissions: [] },
    { key: "payroll", permissions: [] },
    { key: "attendance", permissions: [] },
    { key: "settings", permissions: [] },
]

/** The group of a permission, by the area its key names. */
const GROUP_OF_AREA: Record<string, string> = {
    employees: "employees", profile_requests: "requests", requests: "requests",
    tasks: "tasks", lists: "tasks", obligations: "obligations", records: "records", clients: "clients", locations: "clients", costs: "costs", charges: "costs", cash_advances: "costs",
    dayoff: "dayoff", salary: "salaries", salary_adjustments: "salaries",
    payroll: "payroll", settlements: "payroll", debts: "payroll",
    settings: "settings", audit: "settings", attendance: "attendance",
    tax: "client_portal", client_accounts: "client_portal", client_messages: "client_portal",
}

// A reserved permission is not offered: nothing checks it yet (catalogue.ts).
// Nor is one being split: its parts are, and a role holding it shows them
// ticked (grant-rules.ts, grantsFromRows).
for (const permission of (Object.keys(PERMISSIONS) as Permission[]).filter(p => !isReserved(p) && !isSplit(p))) {
    const group = PERMISSION_GROUPS.find(g => g.key === GROUP_OF_AREA[permission.split(".")[0]])
    // A permission in an area with no group would be a row nobody can tick;
    // fail loudly, at import, rather than leave it out.
    if (!group) throw new Error(`No matrix group for ${permission}`)
    group.permissions.push(permission)
}

export const permissionLabelKey = (permission: Permission) => `perm_${permission.replace(/\./g, "_")}` as TranslationKey
export const groupLabelKey = (group: string) => `perm_group_${group}` as TranslationKey
export const scopeLabelKey = (scope: Scope) => `scope_${scope}` as TranslationKey

const RISK_KEYS: Record<string, TranslationKey> = {
    "Moves money": "risk_moves_money",
    "Cannot be undone": "risk_cannot_be_undone",
    "Affects pay": "risk_affects_pay",
    "Lets outsiders in": "risk_lets_outsiders_in",
}
/** The label for why a permission is high-risk, or null. */
export function riskLabelKey(permission: Permission): TranslationKey | null {
    const risk = (PERMISSIONS[permission] as { highRisk?: string }).highRisk
    return risk ? RISK_KEYS[risk] ?? null : null
}

/** The widest scope a permission may be granted at — what ticking it gives. */
export const widestScope = (permission: Permission): Scope => {
    const scopes = PERMISSIONS[permission].scopes as readonly Scope[]
    return scopes[scopes.length - 1]
}

/**
 * Grants after ticking, unticking or rescoping one row, with what the rest now
 * needs added — the server does the same (normalizeGrants), so the screen
 * shows what will be saved. Unticking something another ticked row needs
 * changes nothing: it would only come back.
 */
export function setGrant(grants: Grants, permission: Permission, scope: Scope | null): Grants {
    const next: Grants = { ...grants }
    if (scope) next[permission] = scope
    else delete next[permission]
    // A tick, not a save: what still needs another area's is greyed, or
    // marked, on the screen, and the server refuses it (PR 372).
    const verdict = normalizeGrants(Object.entries(next).map(([p, s]) => ({ permission: p, scope: s as string })), { needs: false })
    return verdict.ok ? verdict.grants : grants
}

/**
 * For each permission, the ticked rows that need it — why it cannot be
 * unticked: its own area's (`implies`), and another area's (`requires`, PR
 * 372), for a row nothing else brings.
 */
export function neededBy(grants: Grants): Partial<Record<Permission, Permission[]>> {
    const out: Partial<Record<Permission, Permission[]>> = {}
    const held = Object.keys(grants) as Permission[]
    const brought = new Set(held.flatMap(p => (PERMISSIONS[p] as { implies?: readonly Permission[] }).implies ?? []))
    for (const p of held) {
        for (const implied of (PERMISSIONS[p] as { implies?: readonly Permission[] }).implies ?? []) {
            (out[implied] ??= []).push(p)
        }
        if (brought.has(p)) continue
        for (const needs of requiresOf(p)) (out[needs] ??= []).push(p)
    }
    return out
}

/**
 * What a row still needs from another area (LATER_CHANGES_PLAN.md §5.1 rule
 * 1, PR 372): ticked, at its scope; not, as ticking it would give it, its
 * widest. Greyed until each is ticked, held wide enough.
 */
export function needsFirst(grants: Grants, permission: Permission): UnmetNeed[] {
    return unmetNeeds({ ...grants, [permission]: grants[permission] ?? widestScope(permission) }).filter(u => u.permission === permission)
}

/** The rows where two sets of grants differ — a company role against its template. */
export function drift(grants: Grants, template: Grants): Set<Permission> {
    const out = new Set<Permission>()
    for (const p of new Set([...Object.keys(grants), ...Object.keys(template)]) as Set<Permission>) {
        if (grants[p] !== template[p]) out.add(p)
    }
    return out
}

export const toRows = (grants: Grants) => Object.entries(grants).map(([permission, scope]) => ({ permission, scope: scope as Scope }))
export function fromRows(rows: readonly { permission: string; scope: string }[]): Grants {
    const grants: Grants = {}
    for (const r of rows) if (r.permission in PERMISSIONS) grants[r.permission as Permission] = r.scope as Scope
    return grants
}
