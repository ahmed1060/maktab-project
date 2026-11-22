import { prisma } from "@/lib/prisma"
import { and, scopesToTeam, teamMemberWhere } from "@/lib/team-scope"

/**
 * Whether these people may be given this work by this person.
 *
 * One function, because there were four places deciding it and they had
 * drifted. TaskService.create checked the company, the roles and (now) the
 * team. TaskService.updateDetails checked nothing at all — it verified the
 * task belonged to the caller's company and then set whatever assignee ids
 * the request carried, so a task could be reassigned to a user in another
 * company, who would then see its contents in their own task list. The
 * validation schema could not catch it either: `assigneeIds: z.array(z.string())`
 * is a shape, not a permission.
 *
 * That is the shape of this whole class of bug. The rule is written carefully
 * on the path somebody thought about, and the second path that reaches the
 * same column is written later by somebody reading only the first. So the
 * decision lives here and the callers translate the refusal into whatever code
 * their route already promises.
 *
 * `client` takes a transaction when one is open, so a reassignment validates
 * against the same snapshot it writes to.
 *
 * The pickers that hand out this work ask `assignableChoices` below, the
 * same rule as a query (LATER_CHANGES_PLAN.md §5.1 rule 5, PR 371), so what
 * they offer is what this accepts: lib/assignees.test.ts holds the two to
 * the same people.
 */

export type AssigneeVerdict =
    | { ok: true }
    | { ok: false; reason: "NOT_FOUND" | "CROSS_COMPANY" | "ADMIN_TARGET" | "OUTSIDE_TEAM" }

/**
 * What is being handed out: its permission's scope decides whether the
 * assigner is held to their team. Transferring a task joined the rest in PR
 * 371: held for a team, it went to anyone but the company's Admins.
 */
export type AssignPermission = "tasks.create" | "obligations.create" | "obligations.edit" | "tasks.transfer"

type Client = { user: { findMany: (args: any) => Promise<any[]> } }

export async function checkAssignees(
    assigneeIds: string[],
    session: any,
    permission: AssignPermission,
    // `kept`: who the work already has. Someone deleted among them stays,
    // until it's reassigned; nobody deleted is added (PR 371).
    { client = prisma as any, kept = [] }: { client?: Client; kept?: readonly string[] } = {},
): Promise<AssigneeVerdict> {
    if (!assigneeIds || assigneeIds.length === 0) return { ok: true }

    const userRole = session?.user?.role
    const userId = session?.user?.id
    const userCompanyId = session?.user?.companyId

    const assignees = await client.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, companyId: true, role: true, teamLeaderId: true, status: true },
    })

    // Length rather than a per-id check: a duplicate id would otherwise let a
    // short list satisfy a long one.
    if (assignees.length !== new Set(assigneeIds).size) return { ok: false, reason: "NOT_FOUND" }
    // A deleted account is gone, for whoever is assigning, a Super Admin too.
    if (assignees.some(a => a.status === "DELETED" && !kept.includes(a.id))) return { ok: false, reason: "NOT_FOUND" }

    // A Super Admin belongs to no company and may assign anywhere.
    if (userRole === "SUPER_ADMIN") return { ok: true }

    if (assignees.some(a => a.companyId !== userCompanyId)) {
        return { ok: false, reason: "CROSS_COMPANY" }
    }

    if (scopesToTeam(session.user, permission)) {
        if (assignees.some(a => ["ADMIN", "SUPER_ADMIN"].includes(a.role))) {
            return { ok: false, reason: "ADMIN_TARGET" }
        }
        // Themselves included — a leader does their own work too.
        if (assignees.some(a => a.id !== userId && a.teamLeaderId !== userId)) {
            return { ok: false, reason: "OUTSIDE_TEAM" }
        }
    }

    return { ok: true }
}

/**
 * Who this person may hand this work to in a company, as a query on User:
 * the rule checkAssignees applies, for a picker to offer (LATER_CHANGES_PLAN.md
 * §5.1 rule 5, PR 371). Held for a team, oneself and the people one leads,
 * no Admins; for the company, everyone in it; never a deleted account. A
 * Super Admin, who may assign anywhere, with no company picked: everyone's.
 */
export function assignableWhere(session: any, permission: AssignPermission, companyId: string | null) {
    const where: Record<string, any> = { ...(companyId ? { companyId } : {}), status: { not: "DELETED" } }
    if (session?.user?.role !== "SUPER_ADMIN" && scopesToTeam(session.user, permission)) {
        where.role = { notIn: ["ADMIN", "SUPER_ADMIN"] }
        and(where, teamMemberWhere(session.user.id))
    }
    return where
}

/**
 * The people a picker offers, names only (§5.1 rule 5): each one's name and
 * the role a checklist shows beside it, and for Create task the username its
 * bulk upload matches by, as its template already lists (PR 371).
 */
export async function assignableChoices(session: any, permission: AssignPermission, companyId: string | null) {
    return prisma.user.findMany({
        where: assignableWhere(session, permission, companyId),
        select: { id: true, firstName: true, lastName: true, role: true, ...(permission === "tasks.create" ? { username: true } : {}) },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    })
}
