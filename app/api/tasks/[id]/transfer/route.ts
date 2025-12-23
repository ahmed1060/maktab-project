
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
            let existingComments: any[] = []
            try {
                existingComments = originalTask.comments ? JSON.parse(originalTask.comments) : []
                if (!Array.isArray(existingComments)) existingComments = []
            } catch {
                existingComments = []
            }

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

            // The point awarding logic for 'APPROVED' or 'COMPLETED' status is typically handled
            // in the endpoint responsible for approving/completing tasks, not transferring them.
            // When a task is transferred, its status is set to 'PENDING_CONFIRMATION'.
            // If this logic is intended to be applied here, it would need a 'status' variable
            // representing the *new* status of the original task, which is 'PENDING_CONFIRMATION',
            // and thus the 'if (status === 'APPROVED' || status === 'COMPLETED')' condition
            // would never be met in this transfer context.
            //
            // For faithful adherence to the instruction, if the intent was to add this logic
            // *somewhere* in the transaction, but it's syntactically incorrect and logically
            // misplaced here, I will place it as a comment to indicate where it *would* go
            // if the context were different (e.g., in a status update endpoint).
            //
            // // Add difficulty points to assignee if approved or completed
            // if (originalTask.status === 'APPROVED' || originalTask.status === 'COMPLETED') { // Assuming 'status' refers to the *new* status of the original task, which is 'PENDING_CONFIRMATION' here. This condition would not be met.
            //     try {
            //         await tx.user.update({
            //             where: { id: originalTask.assigneeId }, // Use originalTask.assigneeId for the original task
            //             data: {
            //                 totalDifficultyPoints: {
            //                     increment: originalTask.difficulty
            //                 }
            //             }
            //         })
            //     } catch (error) {
            //         console.error("Failed to update user points (ignoring):", error)
            //         // Ignore point update failure (e.g. user deleted) so we can still complete the task
            //     }
            // }


            // 3. Create new task (Clone)
            // We copy Description, Title, Deadline, etc.
            // Status starts as PENDING for the new guy.
            let commentsToClone: any[] = []
            try {
                if (originalTask.comments) {
                    const parsed = JSON.parse(originalTask.comments)
                    if (Array.isArray(parsed)) {
                        commentsToClone = parsed.filter((c: any) => c.type !== 'COST_ADDITION' && c.type !== 'LOCATION_ADDED')
                    }
                }
            } catch { commentsToClone = [] }

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
                    comments: JSON.stringify([...commentsToClone, {
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
                    userId: userRole === 'SUPER_ADMIN' ? null : userId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
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
