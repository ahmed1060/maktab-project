import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TaskDetailClient from "./client"

export default async function TaskDetailPage({ params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const task = await prisma.task.findUnique({
        where: { id: params.id },
        include: {
            // Select, not `assignees: true` — the latter fetches every User
            // column (password hash, salary, plainPasswordEnc historically)
            // straight into the Server->Client RSC payload. Only pick what
            // this page's client component actually renders.
            assignees: {
                select: { id: true, firstName: true, lastName: true, status: true, role: true }
            }
        }
    })

    if (!task) return <div>Task not found</div>

    const userId = (session?.user as any)?.id
    const userRole = (session?.user as any)?.role
    const isAssigned = task.assignees?.some((a: any) => a.id === userId)

    // Auto-update status to IN_PROGRESS if viewed by an assignee
    if (task.status === 'PENDING' && isAssigned) {
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

    const isRestricted = userRole === 'EMPLOYEE' && !isAssigned

    // totalCost is a Prisma.Decimal (F-07) — Server Components can only pass
    // plain serializable values to Client Components.
    const serializedTask = { ...task, totalCost: Number(task.totalCost) }

    return <TaskDetailClient
        task={serializedTask}
        userRole={userRole}
        userId={userId}
        creatorName={creatorName}
        currentUserName={(session?.user as any)?.name}
        isRestricted={isRestricted}
    />
}
