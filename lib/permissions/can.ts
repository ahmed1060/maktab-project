import { definitionOf, type Permission, type Scope } from "./catalogue"
import { decodeGrants } from "./grants"

/**
 * May this person do this, to this?
 *
 * The one question every access check in the product is moving to
 * (ROLES_PLAN.md §3.4). Pure: it takes the actor and the target rather than a
 * request or a database, so the rule can be read and tested on its own — the
 * same reason lib/approval.ts and lib/payroll-scope.ts are pure.
 *
 * The answer comes from the person's role: its grants travel in the session
 * token (lib/auth.ts loads them, and reloads them within a minute of the role
 * changing), so asking costs no query. Nobody holds anything their token does
 * not carry — there is no fallback to a table by role name, because a fallback
 * is how a custom role would quietly be answered as a built-in one.
 */

export type Actor = {
    id?: string | null
    role: string | null | undefined
    companyId?: string | null
    /** The role's grants as the token carries them — see ./grants.ts. */
    grants?: string | null
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
    return decodeGrants(actor.grants)[permission] ?? null
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
    // Before the grant, and for everyone: rule 5 is not something a role can
    // hold its way past.
    if (target?.userId && actor.id && target.userId === actor.id && definitionOf(permission).notOnOwn) return false
    const scope = grantFor(actor, permission)
    if (scope === null) return false
    if (scope === "ALL") return true
    if (!target) return true
    return withinScope(scope, actor, target)
}

/**
 * Whether the actor holds this permission across their whole company — not
 * only for a team or for themselves. For the few rules that separate the
 * people who manage something company-wide from those who manage it for a
 * team, so that difference comes from the grant rather than from a role name.
 */
export function canCompanyWide(actor: Actor, permission: Permission): boolean {
    const scope = grantFor(actor, permission)
    return scope === "ALL" || scope === "COMPANY"
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
