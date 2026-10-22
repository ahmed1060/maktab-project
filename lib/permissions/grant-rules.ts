import { PERMISSIONS, isPermission, isReserved, type Permission, type Scope } from "./catalogue"
import type { Grants } from "./grants"

/**
 * What a role or template may hold, made whole.
 *
 * Every grant written — to a company's role or to a template — goes through
 * here, so a role is never saved holding something that could not be checked:
 *
 * - An unknown permission is refused (ROLES_PLAN.md §5): a key the catalogue
 *   does not know gates nothing, and a typo would look configured.
 * - A scope the permission cannot be granted at is refused (§3.2): an
 *   approval at OWN scope would look configured and do nothing.
 * - A permission a grant is useless without is added (§3.8, `implies`), at the
 *   same scope — widened if it was held narrower, never narrowed. Approving
 *   payroll without seeing it is not a role anybody meant to make.
 */

const WIDTH: Record<Scope, number> = { OWN: 1, TEAM: 2, COMPANY: 3 }

export type GrantInput = { permission: string; scope: string }
export type GrantsVerdict = { ok: true; grants: Grants } | { ok: false; errors: string[] }

export function normalizeGrants(input: readonly GrantInput[]): GrantsVerdict {
    const errors: string[] = []
    const grants: Grants = {}

    for (const { permission, scope } of input) {
        if (!isPermission(permission)) { errors.push(`Unknown permission: ${permission}`); continue }
        // Nothing checks it yet: a role holding it would promise access it
        // does not give (catalogue.ts, `reserved`).
        if (isReserved(permission)) { errors.push(`${permission} is not available yet`); continue }
        if (!(PERMISSIONS[permission].scopes as readonly string[]).includes(scope)) {
            errors.push(`${permission} cannot be granted at ${scope} scope`); continue
        }
        if (grants[permission] && grants[permission] !== scope) {
            errors.push(`${permission} is granted twice, at different scopes`); continue
        }
        grants[permission] = scope as Scope
    }
    if (errors.length) return { ok: false, errors }

    // Until nothing changes: an implied permission may imply another.
    for (let changed = true; changed;) {
        changed = false
        for (const [permission, scope] of Object.entries(grants) as [Permission, Scope][]) {
            for (const implied of (PERMISSIONS[permission] as { implies?: readonly string[] }).implies ?? []) {
                if (!isPermission(implied)) continue
                const held = grants[implied]
                if (held && WIDTH[held] >= WIDTH[scope]) continue
                if (!(PERMISSIONS[implied].scopes as readonly string[]).includes(scope)) {
                    errors.push(`${permission} at ${scope} needs ${implied}, which cannot be granted at ${scope}`)
                    continue
                }
                grants[implied] = scope
                changed = true
            }
        }
    }
    return errors.length ? { ok: false, errors } : { ok: true, grants }
}

/** Grants as rows, for the database and the API. */
export function grantRows(grants: Grants): { permission: Permission; scope: Scope }[] {
    return (Object.entries(grants) as [Permission, Scope][])
        .map(([permission, scope]) => ({ permission, scope }))
        .sort((a, b) => PERMISSIONS[a.permission].code - PERMISSIONS[b.permission].code)
}

/**
 * Whether `held` covers `wanted`: every permission, at an equal or wider scope.
 * The "you can only hand out access you have" rule (§4.2, rule 4).
 */
export function covers(held: Grants, wanted: Grants): boolean {
    return (Object.entries(wanted) as [Permission, Scope][])
        .every(([permission, scope]) => !!held[permission] && WIDTH[held[permission]!] >= WIDTH[scope])
}

/**
 * A role's grant rows as grants. A grant for a permission the catalogue
 * doesn't know is skipped rather than trusted: it can't be encoded, and it
 * gates nothing.
 */
export function grantsFromRows(rows: { permission: string; scope: string }[]): Grants {
    const grants: Grants = {}
    for (const g of rows) if (isPermission(g.permission)) grants[g.permission] = g.scope as Scope
    return grants
}

/** A role template's grants, a JSON list. */
export const templateGrants = (json: unknown): GrantInput[] =>
    Array.isArray(json) ? json.filter((g): g is GrantInput => typeof g?.permission === "string") : []
