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
    const { status: statusProp, action, difficulty } = json // APPROVED or REJECTED
    const status = statusProp || action
    const userId = (session.user as any).id

    const result = await prisma.$transaction(async (tx) => {
        // 1. Fetch current task state to calculate point delta
        const oldTask = await (tx.task as any).findUnique({
            where: { id: params.id },
            select: { status: true, difficulty: true, totalCost: true, assignees: { select: { id: true } } }
        })

        if (!oldTask) throw new Error("Task not found")

        // Role-based self-approval restriction
        const userRole = (session.user as any).role
        const isSelfAssigned = oldTask.assignees.some((a: any) => a.id === userId)
        if (['ADMIN', 'SUPER_ADMIN'].includes(userRole) && isSelfAssigned) {
            throw new Error("Admins cannot approve or reject their own tasks")
        }
        // TEAM_LEADER is allowed to approve/reject their own tasks

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
        const task = await (tx.task as any).update({
            where: { id: params.id },
            data: {
                status: newStatus,
                difficulty: newDifficulty,
                lastStatusUpdateBy: `${(session.user as any).role} ${(session.user as any).name}`
            },
            include: { assignees: true }
        })

        // 5. Apply Point Delta to ALL Assignees
        if (pointDelta !== 0) {
            const allAssigneeIds = (oldTask as any).assignees?.map((a: { id: string }) => a.id) || []

            for (const aId of allAssigneeIds) {
                try {
                    await tx.user.update({
                        where: { id: aId },
                        data: {
                            totalDifficultyPoints: {
                                increment: pointDelta
                            }
                        }
                    })
                } catch (error) {
                    console.error(`Failed to update points for user ${aId}:`, error)
                    throw error
                }
            }
        }

        // Notify all assignees
        const allAssigneeIdsForNotification = task.assignees.map((a: { id: string }) => a.id)

        await tx.notification.createMany({
            data: allAssigneeIdsForNotification.map((aId: string) => ({
                userId: aId,
                type: newStatus === 'APPROVED' ? 'TASK_APPROVED' : newStatus === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_REJECTED',
                message: `Your task "${task.title}" has been ${newStatus === 'APPROVED' ? 'approved' : newStatus === 'COMPLETED' ? 'marked as completed' : 'rejected'}`,
                relatedId: task.id
            }))
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
