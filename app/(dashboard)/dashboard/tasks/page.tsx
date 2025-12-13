import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TasksClient from "./TasksClient"

export default async function TasksPage({ searchParams }: { searchParams: { companyId?: string } }) {
    const session = await getServerSession(authOptions)
    const role = (session?.user as any)?.role
    const companyId = searchParams.companyId

    let whereClause: any = {}

    if (role === 'EMPLOYEE') {
        whereClause.assigneeId = (session?.user as any)?.id
    } else {
        // ADMIN, SUPER_ADMIN, TEAM_LEADER
        if (companyId) {
            whereClause.assignee = { companyId }
        }
    }

    const tasks = await prisma.task.findMany({
        where: whereClause,
        include: {
            assignee: { select: { firstName: true, lastName: true } },
            creator: { select: { firstName: true, lastName: true } }
        },
        orderBy: { createdAt: 'desc' }
    })

    return <TasksClient tasks={tasks} role={role} currentUserId={(session?.user as any)?.id} />
}
