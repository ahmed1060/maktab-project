import { PERMISSIONS, isPermission, isPersonal, isReserved, requiresOf, splitParts, type Permission, type Scope } from "./catalogue"
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
 * - A permission being split is written as its parts, at its scope
 *   (catalogue.ts, `splitInto`; LATER_CHANGES_PLAN.md §2): a role or
 *   template that still names it keeps what it could do.
 * - A permission that needs another area's first is refused without it
 *   (`requires`; LATER_CHANGES_PLAN.md §5.1 rule 1, PR 372), naming what's
 *   missing: nothing across areas is added for the Super Admin. `needs:
 *   false` is for what isn't a save: a tick on the screen, which greys
 *   instead, and grants read to compare.
 */

const WIDTH: Record<Scope, number> = { OWN: 1, TEAM: 2, COMPANY: 3 }

export type GrantInput = { permission: string; scope: string }
export type GrantsVerdict = { ok: true; grants: Grants } | { ok: false; errors: string[] }

/** Grant inputs with each permission being split given as its parts, at its scope. */
const withParts = (input: readonly GrantInput[]): GrantInput[] =>
    input.flatMap(g => isPermission(g.permission) && splitParts(g.permission).length
        ? splitParts(g.permission).map(permission => ({ permission, scope: g.scope }))
        : [g])

export function normalizeGrants(given: readonly GrantInput[], { needs = true }: { needs?: boolean } = {}): GrantsVerdict {
    const errors: string[] = []
    const grants: Grants = {}
    const input = withParts(given)

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
    if (!errors.length && needs) {
        for (const unmet of unmetNeeds(grants)) {
            errors.push(`${unmet.permission} needs ${unmet.needs}${unmet.companyWide ? " for the company" : ""} first`)
        }
    }
    return errors.length ? { ok: false, errors } : { ok: true, grants }
}

export type UnmetNeed = { permission: Permission; needs: Permission; companyWide: boolean }

/**
 * What these grants hold without another area's permission it needs
 * (catalogue.ts, `requires`; LATER_CHANGES_PLAN.md §5.1 rule 1, PR 372): not
 * held, or held narrower than what needs it (`companyWide`, as each needing
 * one is the company's). A permission another held one brings with it
 * carries no needs of its own: See debts, brought by Waive debts, is used on
 * Payroll, not an employee's history.
 */
export function unmetNeeds(grants: Grants): UnmetNeed[] {
    const held = Object.entries(grants) as [Permission, Scope][]
    const brought = new Set(held.flatMap(([p]) => ((PERMISSIONS[p] as { implies?: readonly string[] }).implies ?? []) as Permission[]))
    const out: UnmetNeed[] = []
    for (const [permission, scope] of held) {
        if (brought.has(permission)) continue
        for (const needs of requiresOf(permission)) {
            const has = grants[needs]
            if (has && WIDTH[has] >= WIDTH[scope]) continue
            out.push({ permission, needs, companyWide: !!has })
        }
    }
    return out
}

/** Grants as rows, for the database and the API. */
export function grantRows(grants: Grants): { permission: Permission; scope: Scope }[] {
    return (Object.entries(grants) as [Permission, Scope][])
        .map(([permission, scope]) => ({ permission, scope }))
        .sort((a, b) => PERMISSIONS[a.permission].code - PERMISSIONS[b.permission].code)
}

/**
 * Whether `held` covers `wanted`: every permission, at an equal or wider scope.
 * The "you can only hand out access you have" rule (§4.2, rule 4). A personal
 * permission is no access over anybody (catalogue.ts, `personal`), so it's
 * not asked for.
 */
export function covers(held: Grants, wanted: Grants): boolean {
    return (Object.entries(wanted) as [Permission, Scope][])
        .every(([permission, scope]) => isPersonal(permission) || (!!held[permission] && WIDTH[held[permission]!] >= WIDTH[scope]))
}

/**
 * A role's grant rows as grants. A grant for a permission the catalogue
 * doesn't know is skipped rather than trusted: it can't be encoded, and it
 * gates nothing.
 */
export function grantsFromRows(rows: { permission: string; scope: string }[]): Grants {
    const grants: Grants = {}
    for (const g of rows) {
        if (!isPermission(g.permission)) continue
        // A permission being split is held as its parts (catalogue.ts,
        // `splitInto`): what can() checks, and what a role is shown as.
        for (const permission of splitParts(g.permission).length ? splitParts(g.permission) : [g.permission]) grants[permission] = g.scope as Scope
    }
    return grants
}

/**
 * A role's grant rows as it holds them, for showing or comparing: each
 * permission being split as its parts, in the order of their codes.
 */
export const rowsHeld = (rows: { permission: string; scope: string }[]): { permission: Permission; scope: Scope }[] =>
    grantRows(grantsFromRows(rows))

/** A role template's grants, a JSON list. */
export const templateGrants = (json: unknown): GrantInput[] =>
    Array.isArray(json) ? json.filter((g): g is GrantInput => typeof g?.permission === "string") : []
