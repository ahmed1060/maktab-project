import { prisma } from "./prisma";

/**
 * Verifies if the session user has access to a specific resource based on company isolation.
 * SUPER_ADMIN has access to everything.
 * Other roles can only access resources belonging to their own company.
 */
export async function verifyResourceAccess(
    session: any,
    resourceId: string,
    resourceType: 'USER' | 'TASK' | 'OBLIGATION' | 'CLIENT'
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
                select: { companyId: true }
            });
            return user?.companyId === userCompanyId;
        }
        case 'TASK': {
            const task = await prisma.task.findUnique({
                where: { id: resourceId },
                select: {
                    assignee: { select: { companyId: true } }
                }
            });
            return task?.assignee?.companyId === userCompanyId;
        }
        case 'OBLIGATION': {
            const obligation = await prisma.obligation.findUnique({
                where: { id: resourceId },
                select: {
                    assignee: { select: { companyId: true } }
                }
            });
            return obligation?.assignee?.companyId === userCompanyId;
        }
        case 'CLIENT': {
            const client = await prisma.businessClient.findUnique({
                where: { id: resourceId },
                select: { companyId: true }
            });
            return client?.companyId === userCompanyId;
        }
        default:
            return false;
    }
}
