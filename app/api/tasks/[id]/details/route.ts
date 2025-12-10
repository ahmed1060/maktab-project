import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session || !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes((session.user as any).role)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const json = await req.json()
        console.log("Received update payload:", json) // Debug log
        const { title, description, assigneeId, deadline, difficulty } = json

        // Server-side Deadline Validation
        const deadlineDate = new Date(deadline)
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        if (deadlineDate < today) {
            return new NextResponse("Deadline cannot be in the past", { status: 400 })
        }

        // Fetch existing comments first
        const existingTask = await prisma.task.findUnique({
            where: { id: params.id },
            select: { comments: true }
        })
        const existingComments = existingTask?.comments ? JSON.parse(existingTask.comments) : []

        const updateData: any = {
            title,
            description,
            assignee: { connect: { id: assigneeId } },
            deadline: new Date(deadline),
            difficulty,
            isEdited: true,
            comments: JSON.stringify([...existingComments, {
                text: "Task details updated",
                type: "TASK_EDITED",
                author: `${(session.user as any).role} ${(session.user as any).name}`,
                date: new Date().toISOString()
            }])
        }

        const task = await prisma.task.update({
            where: { id: params.id },
            data: updateData
        })

        // Log audit
        await prisma.auditLog.create({
            data: {
                action: 'UPDATE_TASK_DETAILS',
                entityType: 'TASK',
                entityId: task.id,
                userId: (session.user as any).id,
                details: JSON.stringify(updateData)
            }
        })

        // Create notification for assignee
        await prisma.notification.create({
            data: {
                userId: assigneeId, // Notify the (potentially new) assignee
                type: 'TASK_UPDATED',
                message: `Task "${title}" details have been updated by ${(session.user as any).role} ${(session.user as any).name}. Please review.`,
                relatedId: task.id
            }
        })

        return NextResponse.json(task)
    } catch (error: any) {
        console.error("Update details failed", error)
        return new NextResponse(JSON.stringify({
            name: error.name,
            message: error.message,
            stack: error.stack
        }), { status: 500 })
    }
}
