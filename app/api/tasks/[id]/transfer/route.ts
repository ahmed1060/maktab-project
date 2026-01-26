
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
            // 1. Fetch original task with assignees and companyId
            const originalTask = await (tx.task as any).findUnique({
                where: { id: params.id },
                include: { assignees: true }
            })

            if (!originalTask) throw new Error("Task not found")

            // Permission check
            const currentAssigneeIds = (originalTask as any).assignees.map((a: any) => a.id)
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

            // 2. Prepare original task update
            let existingComments: any[] = []
            try {
                existingComments = originalTask.comments ? JSON.parse(originalTask.comments) : []
                if (!Array.isArray(existingComments)) existingComments = []
            } catch { existingComments = [] }

            const transferComment = {
                text: `Task transfer processed. (Assigned to ${addedIds.length} new users).`,
                author: "System",
                date: new Date().toISOString(),
                type: 'TASK_TRANSFERRED'
            }

            await (tx.task as any).update({
                where: { id: params.id },
                data: {
                    status: 'PENDING_CONFIRMATION',
                    assignees: {
                        set: keptIds.map(id => ({ id }))
                    },
                    comments: JSON.stringify([...existingComments, transferComment]),
                    lastStatusUpdateBy: `${(session.user as any).role} ${(session.user as any).name}`
                }
            })

            // 3. Create ONE Clone for ALL NEW assignees
            let commentsToClone: any[] = []
            try {
                if (originalTask.comments) {
                    const parsed = JSON.parse(originalTask.comments)
                    if (Array.isArray(parsed)) {
                        commentsToClone = parsed.filter((c: any) => c.type !== 'COST_ADDITION' && c.type !== 'LOCATION_ADDED' && c.type !== 'TASK_TRANSFERRED')
                    }
                }
            } catch { commentsToClone = [] }

            let newTask: any = null
            if (addedIds.length > 0) {
                newTask = await (tx.task as any).create({
                    data: {
                        title: originalTask.title + " (Transfer Copy)",
                        description: originalTask.description,
                        companyId: originalTask.companyId,
                        assignees: { connect: addedIds.map(id => ({ id })) },
                        deadline: originalTask.deadline,
                        difficulty: originalTask.difficulty,
                        status: 'PENDING',
                        createdBy: originalTask.createdBy,
                        attachments: originalTask.attachments,
                        location: originalTask.location,
                        comments: JSON.stringify([...commentsToClone, {
                            text: `Transferred from task "${originalTask.title}".`,
                            author: "System",
                            date: new Date().toISOString(),
                            type: 'TASK_CREATED'
                        }])
                    }
                })

                // Create notifications for all new assignees
                await tx.notification.createMany({
                    data: addedIds.map(id => ({
                        userId: id,
                        type: 'TASK_ASSIGNED',
                        message: `You have been assigned a transferred task: ${newTask.title}`,
                        relatedId: newTask.id
                    }))
                })
            }

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
                        newAssigneeIds: addedIds
                    })
                }
            })

            return { originalId: originalTask.id, clones: newTask ? 1 : 0 }
        })

        return NextResponse.json(result)

    } catch (error: any) {
        console.error("Transfer error:", error)
        return new NextResponse(error.message || "Internal Server Error", { status: 500 })
    }
}
