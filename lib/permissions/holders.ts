import { splitFrom, type Permission, type Scope } from "./catalogue"

/**
 * A condition on a User row: their role holds this permission — at this scope,
 * if one is given.
 *
 * For "who should be told", which is a question about people rather than a
 * check on one: whoever can act on a request hears about it, whatever their
 * role is called. Asked of the grants in the database, so a role the Super
 * Admin made for a company is found the same way as a built-in one.
 */
export function holdersOf(permission: Permission, scope?: Scope) {
    // A role still holding what it was split from holds it too (catalogue.ts,
    // `splitInto`), until the grant for companies already there.
    const from = splitFrom(permission)
    return { assignedRole: { grants: { some: { permission: from ? { in: [permission, from] } : permission, ...(scope ? { scope } : {}) } } } }
}
