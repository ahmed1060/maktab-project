import { isPermission, type Permission, type Scope } from "./catalogue"
import type { Grants } from "./grants"
import type { GrantInput } from "./grant-rules"

/**
 * Permission names a row may still have (CLIENTS_PLAN.md §0.3).
 *
 * Vendors became Clients in 0b, and `vendors.*` became `clients.*`. 0b kept
 * writing the old names, which the release before it knew, and 0c rewrote
 * the rows. Every build migrates the one shared database, so 0b's code was
 * live against that while 0c waited for review, and wrote the old names to
 * any role saved then. So this release writes the new names and still reads
 * the old as the new; 0d, with the app closed, rewrites any left and
 * removes this.
 *
 * The codes in the session token don't change (catalogue.ts), so a token
 * reads the same whichever name its role's rows have.
 */
const OLD_NAMES: Record<string, Permission> = {
    "vendors.view": "clients.view",
    "vendors.manage": "clients.manage",
}

/** A stored name as this release calls it: an old name read as the new. */
export const permissionOf = (stored: string): string => OLD_NAMES[stored] ?? stored

/** Every name a permission may be stored under, for a query by permission. */
export const storedNames = (permission: Permission): string[] =>
    [permission, ...Object.keys(OLD_NAMES).filter(old => OLD_NAMES[old] === permission)]

/** Grant rows, or a template's grants, as they're read. */
export const fromStored = <G extends { permission: string }>(rows: G[]): G[] => rows.map(g => ({ ...g, permission: permissionOf(g.permission) }))

/**
 * A role's grant rows as grants, by this release's names. A grant for a
 * permission the catalogue doesn't know is skipped rather than trusted: it
 * can't be encoded, and it gates nothing.
 */
export function grantsFromRows(rows: { permission: string; scope: string }[]): Grants {
    const grants: Grants = {}
    for (const g of fromStored(rows)) if (isPermission(g.permission)) grants[g.permission] = g.scope as Scope
    return grants
}

/** A role template's grants, a JSON list, by this release's names. */
export const templateGrants = (json: unknown): GrantInput[] =>
    Array.isArray(json) ? fromStored(json.filter((g): g is GrantInput => typeof g?.permission === "string")) : []
