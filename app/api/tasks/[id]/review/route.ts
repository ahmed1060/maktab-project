import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const json = await req.json()
    const { status, difficulty } = json // APPROVED or REJECTED, optional difficulty
    const userId = (session.user as any).id

    const result = await prisma.$transaction(async (tx) => {
        // 1. Fetch current task state to calculate point delta
        const oldTask = await tx.task.findUnique({
            where: { id: params.id },
            select: { status: true, difficulty: true, assigneeId: true, totalCost: true }
        })

        if (!oldTask) throw new Error("Task not found")

        // 2. Prepare new values
        let newStatus = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(status) ? status : 'REJECTED'

        // Auto-complete logic: If Approved and no cost, mark as Completed
        if (newStatus === 'APPROVED' && oldTask.totalCost === 0) {
            newStatus = 'COMPLETED'
        }

        const newDifficulty = (typeof difficulty === 'number') ? difficulty : oldTask.difficulty

        // 3. Calculate Point Delta
        // Points are awarded if status is APPROVED or COMPLETED
        const hasPoints = (s: string) => ['APPROVED', 'COMPLETED'].includes(s)

        let pointDelta = 0
        const oldHadPoints = hasPoints(oldTask.status)
        const newHasPoints = hasPoints(newStatus)

        if (!oldHadPoints && newHasPoints) {
            // Case: Pending/Rejected -> Approved/Completed (Add points)
            pointDelta = newDifficulty
        } else if (oldHadPoints && !newHasPoints) {
            // Case: Approved/Completed -> Rejected (Subtract points)
            pointDelta = -oldTask.difficulty
        } else if (oldHadPoints && newHasPoints) {
            // Case: Approved -> Completed (or difficulty change)
            // Adjust for any difference in difficulty
            pointDelta = newDifficulty - oldTask.difficulty
        }

        // 4. Update Task
        const task = await tx.task.update({
            where: { id: params.id },
            data: {
                status: newStatus,
                difficulty: newDifficulty,
                lastStatusUpdateBy: `${(session.user as any).role} ${(session.user as any).name}`
            },
            include: { assignee: true }
        })

        // 5. Apply Point Delta to User
        if (pointDelta !== 0) {
            try {
                await tx.user.update({
                    where: { id: task.assigneeId },
                    data: {
                        totalDifficultyPoints: {
                            increment: pointDelta
                        }
                    }
                })
            } catch (error) {
                console.error("Failed to update user points:", error)
                // We don't rollback the task update if points fail, but in a transaction it's all or nothing usually. 
                // Since this is inside tx, throwing here would rollback. 
                // Given points are critical for this feature, we SHOULD let it fail.
                throw error
            }
        }

        // Notify the assignee
        await tx.notification.create({
            data: {
                userId: task.assigneeId,
                type: newStatus === 'APPROVED' ? 'TASK_APPROVED' : newStatus === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_REJECTED',
                message: `Your task "${task.title}" has been ${newStatus === 'APPROVED' ? 'approved' : newStatus === 'COMPLETED' ? 'marked as completed' : 'rejected'}`,
                relatedId: task.id
            }
        })

        // Audit log
        await tx.auditLog.create({
            data: {
                action: newStatus === 'APPROVED' ? 'APPROVE_TASK' : newStatus === 'COMPLETED' ? 'COMPLETE_TASK' : 'REJECT_TASK',
                entityType: 'TASK',
                entityId: task.id,
                userId: (session.user as any).role === 'SUPER_ADMIN' ? null : userId,
                superAdminId: (session.user as any).role === 'SUPER_ADMIN' ? userId : null,
                details: JSON.stringify({ oldStatus: oldTask.status, newStatus, delta: pointDelta })
            }
        })

        return task
    })

    return NextResponse.json(result)
}
