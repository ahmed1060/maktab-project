import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TaskDetailClient from "./client"

export default async function TaskDetailPage({ params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const task = await prisma.task.findUnique({
        where: { id: params.id },
        include: { assignee: true, assignees: true }
    })

    if (!task) return <div>Task not found</div>

    // Auto-update status to IN_PROGRESS if viewed by assignee
    if (task.status === 'PENDING' && (session?.user as any)?.id === task.assigneeId) {
        await prisma.task.update({
            where: { id: task.id },
            data: { status: 'IN_PROGRESS' }
        })
        task.status = 'IN_PROGRESS' // Update local object for rendering
    }

    // Fetch creator details
    let creatorName = "Unknown"
    if (task.createdBy) {
        const creator = await prisma.user.findUnique({
            where: { id: task.createdBy },
            select: { firstName: true, lastName: true }
        })
        if (creator) {
            creatorName = `${creator.firstName} ${creator.lastName}`
        }
    }

    return <TaskDetailClient task={task} userRole={(session?.user as any)?.role} userId={(session?.user as any)?.id} creatorName={creatorName} currentUserName={(session?.user as any)?.name} />
}
