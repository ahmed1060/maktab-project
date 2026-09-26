import { grantFor, type Actor } from "@/lib/permissions/can"
import type { Permission } from "@/lib/permissions/catalogue"

/**
 * What a Team Leader is allowed to see.
 *
 * One rule, in one place: their own team, and themselves. Not "their company
 * minus admins", which is what the role meant before teams existed and what
 * six separate screens each implemented separately.
 *
 * The composition helper matters as much as the rule. F-03 was a query
 * parameter overwriting a tenancy scope — `whereClause.assignees = ...` after
 * the scope had already set `whereClause.assignees` — and it was fixed once in
 * buildTaskWhereClause while the same line survived in the page beside it,
 * where an employee could read a colleague's tasks by adding ?employeeId= to
 * the URL. A scope that a later assignment can replace is not a scope. So
 * every condition here is added with `and`, which cannot overwrite anything,
 * and callers are expected to add their filters the same way.
 */

/**
 * Whether this person's reach over one kind of thing stops at their team.
 *
 * Asked of a permission, not a role: it is true when they hold it at TEAM scope
 * — a Team Leader today, and in Part B any role granted it that way. Someone
 * holding it company-wide manages the company, of which a team is a
 * subdivision; someone not holding it at all is narrowed to themselves by a
 * tighter rule, applied separately.
 */
export function scopesToTeam(actor: Actor, permission: Permission): boolean {
    return grantFor(actor, permission) === "TEAM"
}

/**
 * A condition on a User row: this person is on my team, or is me.
 *
 * The second half is not a courtesy. Without it a leader's own tasks, their
 * own row in the employee list and their own requests all vanish from their
 * own screens, which reads as the feature being broken rather than scoped.
 */
export function teamMemberWhere(leaderId: string) {
    return { OR: [{ teamLeaderId: leaderId }, { id: leaderId }] }
}

/**
 * A condition on anything assigned to people — tasks, obligations: at least
 * one assignee is on my team.
 *
 * Deliberately `some` over the team rather than `none` over myself, which is
 * what the old "active tasks" view did. `none: { id: me }` meant "everything
 * in the company that is not mine", so it grew as the company grew and had
 * nothing to do with the leader's team.
 */
export function assignedToTeamWhere(leaderId: string) {
    return { assignees: { some: teamMemberWhere(leaderId) } }
}

/** Assigned to one of my reports specifically — my team's work, not my own. */
export function assignedToReportsWhere(leaderId: string) {
    return { assignees: { some: { teamLeaderId: leaderId } } }
}

/**
 * Add a condition to a where clause without being able to replace anything.
 *
 * Every scope and every filter goes through this. A plain assignment is the
 * bug this file exists to prevent, and it is the kind that looks correct in
 * review because the assignment and the scope are usually forty lines apart.
 */
export function and<T extends Record<string, any>>(where: T, condition: unknown): T {
    const existing = (where as any).AND
    const list = Array.isArray(existing) ? existing : existing ? [existing] : []
    ;(where as any).AND = [...list, condition]
    return where
}
