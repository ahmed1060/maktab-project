import type { Permission, Scope } from "./catalogue"
import { storedNames } from "./stored-names"

/**
 * A condition on a User row: their role holds this permission — at this scope,
 * if one is given.
 *
 * For "who should be told", which is a question about people rather than a
 * check on one: whoever can act on a request hears about it, whatever their
 * role is called. Asked of the grants in the database, so a role the Super
 * Admin made for a company is found the same way as a built-in one. By any
 * name the permission is stored under (./stored-names.ts).
 */
export function holdersOf(permission: Permission, scope?: Scope) {
    return { assignedRole: { grants: { some: { permission: { in: storedNames(permission) }, ...(scope ? { scope } : {}) } } } }
}
