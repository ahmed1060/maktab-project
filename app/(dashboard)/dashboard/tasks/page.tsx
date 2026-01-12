import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TasksClient from "./TasksClient"

export default async function TasksPage({ searchParams }: { searchParams: { company?: string } }) {
    const session = await getServerSession(authOptions)
    const role = (session?.user as any)?.role

    let companyId: string | undefined = undefined
    if (searchParams.company) {
        const comp = await prisma.company.findUnique({ where: { name: searchParams.company } })
        if (comp) companyId = comp.id
    }

    const whereClause: any = {}
    const userCompanyId = (session?.user as any)?.companyId

    if (role === 'EMPLOYEE') {
        const userId = (session?.user as any)?.id
        whereClause.OR = [
            { assigneeId: userId },
            { assignees: { some: { id: userId } } }
        ]
    } else if (['ADMIN', 'TEAM_LEADER'].includes(role)) {
        // Strict isolation for Admin/Team Leader: Must match their company
        if (!userCompanyId) {
            // Unassigned Admins see nothing
            const tasks: any[] = []
            return <TasksClient tasks={tasks} role={role} currentUserId={(session?.user as any)?.id} />
        }
        whereClause.assignee = { companyId: userCompanyId }
    } else if (role === 'SUPER_ADMIN') {
        // Super Admin can filter by company or see everything
        if (companyId) {
            whereClause.assignee = { companyId }
        }
    }

    const tasks = await (prisma.task as any).findMany({
        where: whereClause,
        include: {
            assignee: { select: { firstName: true, lastName: true } },
            assignees: { select: { id: true, firstName: true, lastName: true } },
            creator: { select: { firstName: true, lastName: true } }
        },
        // We select these manually since they are not in the include or we can just let include fetch all and use select
        // Actually findMany with include/select is common. I'll just rely on the default findMany for those fields.
        // Prisma include adds relations, but scalar fields are included by default.
        // So I just need to make sure I don't use 'select' which would exclude them.
        orderBy: { createdAt: 'desc' }
    })

    return <TasksClient tasks={tasks} role={role} currentUserId={(session?.user as any)?.id} />
}
