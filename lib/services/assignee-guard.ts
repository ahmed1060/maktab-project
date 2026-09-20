import { prisma } from "@/lib/prisma"
import { scopesToTeam } from "@/lib/team-scope"

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
 */

export type AssigneeVerdict =
    | { ok: true }
    | { ok: false; reason: "NOT_FOUND" | "CROSS_COMPANY" | "ADMIN_TARGET" | "OUTSIDE_TEAM" }

type Client = { user: { findMany: (args: any) => Promise<any[]> } }

export async function checkAssignees(
    assigneeIds: string[],
    session: any,
    client: Client = prisma as any,
): Promise<AssigneeVerdict> {
    if (!assigneeIds || assigneeIds.length === 0) return { ok: true }

    const userRole = session?.user?.role
    const userId = session?.user?.id
    const userCompanyId = session?.user?.companyId

    // A Super Admin belongs to no company and may assign anywhere.
    if (userRole === "SUPER_ADMIN") return { ok: true }

    const assignees = await client.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, companyId: true, role: true, teamLeaderId: true },
    })

    // Length rather than a per-id check: a duplicate id would otherwise let a
    // short list satisfy a long one.
    if (assignees.length !== new Set(assigneeIds).size) return { ok: false, reason: "NOT_FOUND" }

    if (assignees.some(a => a.companyId !== userCompanyId)) {
        return { ok: false, reason: "CROSS_COMPANY" }
    }

    if (scopesToTeam(userRole)) {
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
