import type { Permission, Scope } from "./catalogue"
import { BUILT_IN_GRANTS, isBuiltInRole } from "./built-in"

/**
 * May this person do this, to this?
 *
 * The one question every access check in the product is moving to
 * (ROLES_PLAN.md §3.4). Pure: it takes the actor and the target rather than a
 * request or a database, so the rule can be read and tested on its own — the
 * same reason lib/approval.ts and lib/payroll-scope.ts are pure.
 *
 * Today the answer comes from the fixed built-in table (./built-in.ts), so it
 * says exactly what the role checks it replaces said. In Part B it will come
 * from the person's role instead, and nothing that calls it changes.
 */

export type Actor = {
    id?: string | null
    role: string | null | undefined
    companyId?: string | null
}

/**
 * What is being acted on. Only the fields the grant's scope needs are read:
 * COMPANY scope reads `companyId`; TEAM and OWN also read `userId` and
 * `teamLeaderId` of the person the thing belongs to.
 */
export type Target = {
    companyId?: string | null
    userId?: string | null
    teamLeaderId?: string | null
}

/** The scope at which this actor holds this permission, or null. */
export function grantFor(actor: Actor, permission: Permission): Scope | "ALL" | null {
    if (actor.role === "SUPER_ADMIN") return "ALL"
    if (!isBuiltInRole(actor.role)) return null
    return BUILT_IN_GRANTS[actor.role][permission] ?? null
}

/**
 * Whether the actor may do this.
 *
 * Without a target it answers "do they hold this permission anywhere" — enough
 * to decide whether to show a button, never enough to act on a record. With a
 * target it also checks the record is inside the grant's scope: the actor's own
 * company always, and for TEAM or OWN, the right person too.
 *
 * Anything it cannot establish is a no. A company-scoped actor with no company,
 * a TEAM grant asked about a target with no person — each refuses rather than
 * guesses, because every one of those is the shape a tenancy leak takes.
 */
export function can(actor: Actor, permission: Permission, target?: Target): boolean {
    const scope = grantFor(actor, permission)
    if (scope === null) return false
    if (scope === "ALL") return true
    if (!target) return true
    return withinScope(scope, actor, target)
}

/**
 * Whether a target falls inside a grant of this scope. Separate from can() so
 * each scope's rule is tested directly, including the ones no built-in role
 * holds yet.
 */
export function withinScope(scope: Scope, actor: Actor, target: Target): boolean {
    if (!actor.companyId) return false
    if (target.companyId !== actor.companyId) return false

    switch (scope) {
        case "COMPANY":
            return true
        case "TEAM":
            if (!target.userId || !actor.id) return false
            return target.userId === actor.id || target.teamLeaderId === actor.id
        case "OWN":
            return !!actor.id && target.userId === actor.id
    }
}
