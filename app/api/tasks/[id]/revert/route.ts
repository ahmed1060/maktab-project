import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const userRole = (session.user as any).role
    if (userRole !== 'SUPER_ADMIN') {
        return new NextResponse("Forbidden: Only Super Admins can revert tasks", { status: 403 })
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const task = await (tx.task as any).findUnique({
                where: { id: params.id },
                include: {
                    assignees: { select: { id: true } }
                }
            }) as any

            if (!task) throw new Error("Task not found")

            // Payment check
            if (task.paymentStatus !== 'PENDING_PAYMENT') {
                throw new Error("Cannot revert task that has been paid")
            }

            // Calculate points to deduct
            // Points were awarded if status was APPROVED or COMPLETED
            const hadPoints = ['APPROVED', 'COMPLETED'].includes(task.status)
            const pointDeduction = hadPoints ? task.difficulty : 0

            // Update task status
            const updatedTask = await tx.task.update({
                where: { id: params.id },
                data: {
                    status: 'IN_PROGRESS',
                    lastStatusUpdateBy: `SUPER_ADMIN ${session.user.name}`
                }
            })

            // Deduct points from assignees
            if (pointDeduction > 0) {
                const assigneeIds = (task.assignees.length > 0)
                    ? task.assignees.map((a: { id: string }) => a.id)
                    : [task.assigneeId]

                await tx.user.updateMany({
                    where: { id: { in: assigneeIds } },
                    data: {
                        totalDifficultyPoints: {
                            decrement: pointDeduction
                        }
                    }
                })
            }

            // Create notification for all assignees
            const targetIds = (task.assignees.length > 0)
                ? task.assignees.map((a: { id: string }) => a.id)
                : [task.assigneeId]

            await tx.notification.createMany({
                data: targetIds.map((id: string) => ({
                    userId: id,
                    type: 'TASK_REVERTED',
                    message: `Super Admin has reverted task "${task.title}" back to In Progress.`,
                    relatedId: task.id
                }))
            })

            // Determine if user exists in SuperAdmin or User table for AuditLog
            const currentUserId = (session.user as any).id
            const isSuperAdminEntity = await tx.superAdmin.findUnique({ where: { id: currentUserId } })

            // Audit log
            await tx.auditLog.create({
                data: {
                    action: 'REVERT_TASK',
                    entityType: 'TASK',
                    entityId: task.id,
                    superAdminId: isSuperAdminEntity ? currentUserId : null,
                    userId: isSuperAdminEntity ? null : currentUserId,
                    details: JSON.stringify({
                        oldStatus: task.status,
                        newStatus: 'IN_PROGRESS',
                        pointsDeducted: pointDeduction,
                        assigneesNotified: targetIds.length
                    })
                }
            })

            return updatedTask
        })

        return NextResponse.json(result)
    } catch (error: any) {
        console.error("Task reversion failed:", error)
        return new NextResponse(JSON.stringify({
            message: error.message || "Failed to revert task",
            details: error.toString()
        }), { status: 500 })
    }
}
