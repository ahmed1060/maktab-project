import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TasksClient from "./TasksClient"

export default async function TasksPage() {
    const session = await getServerSession(authOptions)
    const role = (session?.user as any)?.role

    const tasks = await prisma.task.findMany({
        where: role === 'EMPLOYEE' ? { assigneeId: (session?.user as any)?.id } : {},
        include: { assignee: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' }
    })

    return <TasksClient tasks={tasks} role={role} currentUserId={(session?.user as any)?.id} />
}
