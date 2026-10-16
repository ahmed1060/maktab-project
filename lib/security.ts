import { prisma } from "./prisma";
import { scopesToTeam } from "./team-scope";
import type { Target } from "./permissions/can";
import type { Permission } from "./permissions/catalogue";

/**
 * Whether this session may touch this resource.
 *
 * The single gate behind 27 routes, which is why the team rule goes here
 * rather than into each of them. It used to check one thing — same company —
 * and that was the whole of a Team Leader's boundary, so a leader holding a
 * task id could act on any task the company had. Hiding a task from a list is
 * not the same as refusing to act on it, and only one of those is a
 * permission.
 *
 * SUPER_ADMIN is exempt entirely. An ADMIN is bounded by their company. A
 * TEAM_LEADER is bounded by their company and then by their team.
 *
 * The resource types below are people or people's work, so the team rule
 * applies to them. A client's records are the company's and belong to nobody
 * in particular, so RecordService checks them by company alone.
 *
 * `acting` is the permission the caller is about to use on it, when it is more
 * than looking. Its own scope counts too: a role may see every task yet pay
 * only its team's, and the team rule must then hold for paying.
 */
export async function verifyResourceAccess(
    session: any,
    resourceId: string,
    resourceType: 'USER' | 'TASK' | 'OBLIGATION',
    acting?: Permission,
) {
    if (!session || !session.user) return false;

    const userRole = session.user.role;
    const userCompanyId = session.user.companyId;

    // Super Admin is exempt from company isolation
    if (userRole === 'SUPER_ADMIN') return true;

    // All other roles MUST have a companyId to access any company resource
    if (!userCompanyId) return false;

    // Held for a team: by the view permission, or by the one being used.
    const teamOnly = (view: Permission) => scopesToTeam(session.user, view) || (!!acting && scopesToTeam(session.user, acting));

    switch (resourceType) {
        case 'USER': {
            const user = await prisma.user.findUnique({
                where: { id: resourceId },
                select: { id: true, companyId: true, teamLeaderId: true }
            });
            if (!user || user.companyId !== userCompanyId) return false;
            if (teamOnly("employees.view")) {
                // Themselves, or somebody who reports to them. An employee with
                // no leader belongs to the Admins, so a leader cannot reach
                // them here either.
                return user.id === session.user.id || user.teamLeaderId === session.user.id;
            }
            return true;
        }
        case 'TASK': {
            const task = await prisma.task.findUnique({
                where: { id: resourceId },
                select: {
                    companyId: true,
                    // Two columns, not the assignee rows. This runs on every
                    // request to every task route, and `assignees: true` would
                    // load whole User records — salaries included — to answer a
                    // yes-or-no question.
                    assignees: { select: { id: true, teamLeaderId: true } }
                }
            });
            if (!task || task.companyId !== userCompanyId) return false;
            if (teamOnly("tasks.view")) return isTeamWork(task.assignees, session.user.id);
            return true;
        }
        case 'OBLIGATION': {
            const obligation = await prisma.obligation.findUnique({
                where: { id: resourceId },
                select: {
                    companyId: true,
                    assignees: { select: { id: true, teamLeaderId: true } }
                }
            });
            if (!obligation || obligation.companyId !== userCompanyId) return false;
            if (teamOnly("obligations.view")) return isTeamWork(obligation.assignees, session.user.id);
            return true;
        }
        default:
            return false;
    }
}

/**
 * Whether a piece of assigned work belongs to this leader's team.
 *
 * Note what an empty list means: work assigned to nobody is not the team's, so
 * a leader cannot act on it. That matches the rule for people — an employee
 * with no leader belongs to the Admins — and it is the safe direction to be
 * wrong in.
 */
export function isTeamWork(
    assignees: { id: string; teamLeaderId: string | null }[],
    leaderId: string,
): boolean {
    return assignees.some(a => a.id === leaderId || a.teamLeaderId === leaderId);
}

/**
 * A person as can() reads a target: their company, their id and their leader.
 * For the decisions that are about somebody — their pay, their leave, their
 * name — so a grant's scope, and the rule that nobody decides their own, are
 * checked against the right person. Null for nobody.
 */
export async function personTarget(userId: string): Promise<Target | null> {
    const person = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, companyId: true, teamLeaderId: true },
    })
    return person ? { companyId: person.companyId, userId: person.id, teamLeaderId: person.teamLeaderId } : null
}

/**
 * Which table the signed-in id belongs to: SUPER_ADMIN for a SuperAdmin row,
 * anything else for a User row. Not the same as session.user.role while the
 * Super Admin previews a role (ROLES_PLAN.md §6.6) — that presents the
 * previewed role, for access, while the id is still the Super Admin's.
 * Anything that looks a person up, or attributes something to them, asks this.
 */
export function accountKind(user: { role?: string | null; preview?: unknown }): string | undefined {
    return user.preview ? 'SUPER_ADMIN' : user.role ?? undefined
}
