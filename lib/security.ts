import { prisma } from "./prisma";
import { scopesToTeam } from "./team-scope";

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
 * Three of the resource types below are people or people's work, so the team
 * rule applies to them. Clients, sections and notes are company resources that
 * belong to nobody in particular — narrowing those to a team would not protect
 * a person, it would just stop leaders doing the job they are given a Clients
 * screen for.
 */
export async function verifyResourceAccess(
    session: any,
    resourceId: string,
    resourceType: 'USER' | 'TASK' | 'OBLIGATION' | 'CLIENT' | 'SECTION' | 'NOTE'
) {
    if (!session || !session.user) return false;

    const userRole = session.user.role;
    const userCompanyId = session.user.companyId;

    // Super Admin is exempt from company isolation
    if (userRole === 'SUPER_ADMIN') return true;

    // All other roles MUST have a companyId to access any company resource
    if (!userCompanyId) return false;

    switch (resourceType) {
        case 'USER': {
            const user = await prisma.user.findUnique({
                where: { id: resourceId },
                select: { id: true, companyId: true, teamLeaderId: true }
            });
            if (!user || user.companyId !== userCompanyId) return false;
            if (scopesToTeam(session.user, "employees.view")) {
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
            if (scopesToTeam(session.user, "tasks.view")) return isTeamWork(task.assignees, session.user.id);
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
            if (scopesToTeam(session.user, "obligations.view")) return isTeamWork(obligation.assignees, session.user.id);
            return true;
        }
        case 'CLIENT': {
            const client = await prisma.businessClient.findUnique({
                where: { id: resourceId },
                select: { companyId: true }
            });
            return client?.companyId === userCompanyId;
        }
        case 'SECTION': {
            const section = await prisma.businessClientSection.findUnique({
                where: { id: resourceId },
                include: { client: { select: { companyId: true } } }
            });
            return section?.client.companyId === userCompanyId;
        }
        case 'NOTE': {
            const note = await prisma.businessClientNote.findUnique({
                where: { id: resourceId },
                include: { section: { include: { client: { select: { companyId: true } } } } }
            });
            return note?.section.client.companyId === userCompanyId;
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
