
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    const json = await req.json()
    const { newAssigneeIds } = json
    const userId = (session.user as any).id
    const userRole = (session.user as any).role

    if (!newAssigneeIds || !Array.isArray(newAssigneeIds) || newAssigneeIds.length === 0) {
        return new NextResponse("New Assignee IDs array required", { status: 400 })
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch original task with assignees
            const originalTask = await tx.task.findUnique({
                where: { id: params.id },
                include: { assignees: true }
            })

            if (!originalTask) throw new Error("Task not found")

            // Permission check
            const currentAssigneeIds = originalTask.assignees.map((a: any) => a.id)
            if (!currentAssigneeIds.includes(originalTask.assigneeId)) {
                currentAssigneeIds.push(originalTask.assigneeId)
            }

            const isAssignee = currentAssigneeIds.includes(userId)
            if (!isAssignee && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
                throw new Error("Unauthorized to transfer this task")
            }

            // Identify changes
            const keptIds = newAssigneeIds.filter((id: string) => currentAssigneeIds.includes(id))
            const addedIds = newAssigneeIds.filter((id: string) => !currentAssigneeIds.includes(id))
            const removedIds = currentAssigneeIds.filter((id: string) => !newAssigneeIds.includes(id))

            // TEAM_LEADER Restriction check for ADDED users
            if (userRole === 'TEAM_LEADER' && addedIds.length > 0) {
                const targetUsers = await tx.user.findMany({
                    where: { id: { in: addedIds } },
                    select: { role: true }
                })
                if (targetUsers.some(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))) {
                    throw new Error("Team Leaders cannot transfer tasks to Admins or Super Admins")
                }
            }

            // 2. Update task assignees
            let existingComments: any[] = []
            try {
                existingComments = originalTask.comments ? JSON.parse(originalTask.comments) : []
                if (!Array.isArray(existingComments)) existingComments = []
            } catch { existingComments = [] }

            const transferComment = {
                text: `Task assignees updated via transfer.`,
                author: "System",
                date: new Date().toISOString(),
                type: 'TASK_TRANSFERRED'
            }

            const updatedTask = await tx.task.update({
                where: { id: params.id },
                data: {
                    status: 'PENDING_CONFIRMATION',
                    assignees: {
                        set: newAssigneeIds.map((id: string) => ({ id }))
                    },
                    // If the primary assignee was removed, pick the first new one as primary
                    assigneeId: newAssigneeIds.includes(originalTask.assigneeId) ? originalTask.assigneeId : (newAssigneeIds[0] || originalTask.assigneeId),
                    comments: JSON.stringify([...existingComments, transferComment]),
                    lastStatusUpdateBy: `${(session.user as any).role} ${(session.user as any).name}`
                },
                include: { assignees: true }
            })

            // 3. Notify NEW assignees who weren't already on the task
            await tx.notification.createMany({
                data: addedIds.map((newId: string) => ({
                    userId: newId,
                    type: 'TASK_ASSIGNED',
                    message: `You have been assigned to the task: ${originalTask.title}`,
                    relatedId: originalTask.id
                }))
            })

            // 4. Audit
            await tx.auditLog.create({
                data: {
                    action: 'TRANSFER_TASK',
                    entityType: 'TASK',
                    entityId: originalTask.id,
                    userId: userRole === 'SUPER_ADMIN' ? null : userId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: JSON.stringify({
                        addedCount: addedIds.length,
                        removedCount: removedIds.length,
                        keptCount: keptIds.length,
                        newAssigneeIds: newAssigneeIds
                    })
                }
            })

            return updatedTask
        })

        return NextResponse.json(result)

    } catch (error: any) {
        console.error("Transfer error:", error)
        return new NextResponse(error.message || "Internal Server Error", { status: 500 })
    }
}
