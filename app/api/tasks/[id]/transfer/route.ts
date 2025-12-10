
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const json = await req.json()
    const { newAssigneeId } = json
    const userId = (session.user as any).id
    const userRole = (session.user as any).role

    if (!newAssigneeId) return new NextResponse("New Assignee ID required", { status: 400 })

    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch original task
            const originalTask = await tx.task.findUnique({
                where: { id: params.id }
            })

            if (!originalTask) throw new Error("Task not found")

            // Permission check: assignee or admin/team leader
            if (originalTask.assigneeId !== userId && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
                throw new Error("Unauthorized to transfer this task")
            }

            // 2. Update original task to SUBMITTED
            // We append a comment to indicate it was transferred
            const existingComments = originalTask.comments ? JSON.parse(originalTask.comments) : []
            const transferComment = {
                text: "Task transferred to new employee. (Auto-submitted for review)",
                author: "System",
                date: new Date().toISOString()
            }

            await tx.task.update({
                where: { id: params.id },
                data: {
                    status: 'PENDING_CONFIRMATION',
                    difficulty: originalTask.difficulty,
                    comments: JSON.stringify([...existingComments, transferComment]),
                    lastStatusUpdateBy: `${(session.user as any).role} ${(session.user as any).name}`
                }
            })

            // 3. Create new task (Clone)
            // We copy Description, Title, Deadline, etc.
            // Status starts as PENDING for the new guy.
            const newTask = await tx.task.create({
                data: {
                    title: originalTask.title + " (Transfer Copy)",
                    description: originalTask.description,
                    assigneeId: newAssigneeId,
                    deadline: originalTask.deadline,
                    difficulty: originalTask.difficulty,
                    status: 'PENDING',
                    createdBy: originalTask.createdBy,
                    attachments: originalTask.attachments,
                    // Exclude totalCost and location explicitly (let defaults take over)
                    comments: JSON.stringify([...(originalTask.comments ? JSON.parse(originalTask.comments).filter((c: any) => c.type !== 'COST_ADDITION' && c.type !== 'LOCATION_ADDED') : []), {
                        text: `Transferred from task "${originalTask.title}".`,
                        author: "System",
                        date: new Date().toISOString()
                    }])
                }
            })

            // 4. Notifications
            // Notify new assignee
            await tx.notification.create({
                data: {
                    userId: newAssigneeId,
                    type: 'TASK_ASSIGNED',
                    message: `You have been assigned a transferred task: ${newTask.title}`,
                    relatedId: newTask.id
                }
            })

            // Audit
            await tx.auditLog.create({
                data: {
                    action: 'TRANSFER_TASK',
                    entityType: 'TASK',
                    entityId: originalTask.id,
                    userId: userId,
                    details: JSON.stringify({ newTaskId: newTask.id, newAssigneeId })
                }
            })

            return newTask
        })

        return NextResponse.json(result)

    } catch (error: any) {
        console.error("Transfer error:", error)
        return new NextResponse(error.message || "Internal Server Error", { status: 500 })
    }
}
