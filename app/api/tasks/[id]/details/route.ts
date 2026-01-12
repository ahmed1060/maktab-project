import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session || !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes((session.user as any).role)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    try {
        const json = await req.json()
        console.log("Received update payload:", json) // Debug log
        const { title, description, assigneeId, deadline, difficulty, location } = json

        if (title && (title.length < 3 || title.length > 100)) {
            return new NextResponse("Title must be between 3 and 100 characters", { status: 400 })
        }
        if (description && (description.length < 10 || description.length > 1000)) {
            return new NextResponse("Description must be between 10 and 1000 characters", { status: 400 })
        }

        // Server-side Deadline Validation
        if (!deadline) {
            return new NextResponse("Deadline is required", { status: 400 })
        }
        const deadlineDate = new Date(deadline)
        if (isNaN(deadlineDate.getTime())) {
            return new NextResponse("Invalid deadline date format", { status: 400 })
        }

        const today = new Date()
        today.setHours(0, 0, 0, 0)

        if (deadlineDate < today) {
            return new NextResponse("Deadline cannot be in the past", { status: 400 })
        }

        // Fetch existing comments and details first
        const existingTask = await prisma.task.findUnique({
            where: { id: params.id },
            select: { comments: true, title: true, description: true, location: true }
        })
        const existingComments = existingTask?.comments ? JSON.parse(existingTask.comments) : []

        // Detect changes
        const changes: any = {}
        if (existingTask) {
            if (existingTask.title !== title) changes.title = { from: existingTask.title, to: title }
            if (existingTask.description !== description) changes.description = { from: existingTask.description, to: description }
            if (existingTask.location !== location) changes.location = { from: existingTask.location, to: location }
        }

        const updateData: any = {
            title,
            description,
            assignee: { connect: { id: assigneeId } },
            deadline: new Date(deadline),
            difficulty,
            location,
            isEdited: true,
            comments: JSON.stringify([...existingComments, {
                text: "Task details updated",
                type: "TASK_EDITED",
                author: `${(session.user as any).role} ${(session.user as any).name}`,
                changes: changes,
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
                userId: (session.user as any).role === 'SUPER_ADMIN' ? null : (session.user as any).id,
                superAdminId: (session.user as any).role === 'SUPER_ADMIN' ? (session.user as any).id : null,
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
