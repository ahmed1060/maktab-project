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
        // If difficulty is provided, update it first
        let taskData: any = {
            status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
            lastStatusUpdateBy: `${(session.user as any).role} ${(session.user as any).name}`
        }

        if (typeof difficulty === 'number') {
            taskData.difficulty = difficulty
        }

        const task = await tx.task.update({
            where: { id: params.id },
            data: taskData,
            include: { assignee: true }
        })

        // Add difficulty points to assignee if approved
        if (status === 'APPROVED') {
            await tx.user.update({
                where: { id: task.assigneeId },
                data: {
                    totalDifficultyPoints: {
                        increment: task.difficulty
                    }
                }
            })
        }

        // Notify the assignee
        await tx.notification.create({
            data: {
                userId: task.assigneeId,
                type: status === 'APPROVED' ? 'TASK_APPROVED' : 'TASK_REJECTED',
                message: `Your task "${task.title}" has been ${status === 'APPROVED' ? 'approved' : 'rejected'}`,
                relatedId: task.id
            }
        })

        // Audit log
        await tx.auditLog.create({
            data: {
                action: status === 'APPROVED' ? 'APPROVE_TASK' : 'REJECT_TASK',
                entityType: 'TASK',
                entityId: task.id,
                userId: userId,
                details: JSON.stringify({ status, difficulty })
            }
        })

        return task
    })

    return NextResponse.json(result)
}
