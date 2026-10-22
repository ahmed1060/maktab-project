import { isPermission, type Permission, type Scope } from "./catalogue"
import type { Grants } from "./grants"
import type { GrantInput } from "./grant-rules"

/**
 * Permission names as the database stores them (CLIENTS_PLAN.md §0.3).
 *
 * Vendors became Clients in 0b, and `vendors.*` became `clients.*`, but the
 * rows keep the old names until 0c rewrites them. Every build migrates the
 * one shared database, so main's code is live against it while each PR waits
 * for review, and it knows only the old names: a row renamed under it would
 * be a grant it no longer sees. So this release reads both names and writes
 * the old one, and 0c, with this release live, can rewrite the rows. 0c also
 * removes this.
 *
 * The codes in the session token don't change (catalogue.ts), so a token
 * reads the same whichever name its role's rows have.
 */
const STORED_AS: Partial<Record<Permission, string>> = {
    "clients.view": "vendors.view",
    "clients.manage": "vendors.manage",
}
const READ_AS: Record<string, Permission> = Object.fromEntries(Object.entries(STORED_AS).map(([name, stored]) => [stored, name as Permission]))

/** The name a permission is written under. */
export const storedName = (permission: Permission): string => STORED_AS[permission] ?? permission

/** A stored name as this release calls it: the old name read as the new. */
export const permissionOf = (stored: string): string => READ_AS[stored] ?? stored

/** Every name a permission may be stored under, for a query by permission. */
export const storedNames = (permission: Permission): string[] => (STORED_AS[permission] ? [permission, STORED_AS[permission]] : [permission])

/** Grant rows, or a template's grants, as they're written. */
export const toStored = <G extends { permission: string }>(rows: G[]): G[] =>
    rows.map(g => ({ ...g, permission: isPermission(g.permission) ? storedName(g.permission) : g.permission }))

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
