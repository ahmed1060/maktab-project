import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyResourceAccess } from "@/lib/security"
import { extractCoords, calculateDistance } from "@/lib/location"

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied", { status: 403 })
    }

    const { title, description, assigneeIds, deadline, difficulty, location, attachments } = json
    const finalAssigneeIds: string[] = assigneeIds || []

    if (title && (title.length < 3 || title.length > 100)) return new NextResponse("Title length error", { status: 400 })
    if (description && (description.length < 10 || description.length > 1000)) return new NextResponse("Description length error", { status: 400 })
    if (!deadline) return new NextResponse("Deadline required", { status: 400 })

    const deadlineDate = new Date(deadline)
    if (isNaN(deadlineDate.getTime())) return new NextResponse("Invalid deadline", { status: 400 })

    const existingTask = await prisma.task.findUnique({
        where: { id: params.id },
        select: { comments: true, title: true, description: true, location: true, attachments: true }
    })
    if (!existingTask) return new NextResponse("Task not found", { status: 404 })

    const existingComments = existingTask.comments ? JSON.parse(existingTask.comments) : []
    const changes: any = {}
    if (existingTask.title !== title) changes.title = { from: existingTask.title, to: title }
    if (existingTask.description !== description) changes.description = { from: existingTask.description, to: description }
    if (existingTask.location !== location) changes.location = { from: existingTask.location, to: location }

    let finalComments = [...existingComments, {
        text: "Task details updated",
        type: "TASK_EDITED",
        author: `${userRole} ${session.user.name}`,
        changes: changes,
        date: new Date().toISOString()
    }]

    if (location) {
        const targetCoords = extractCoords(location)
        if (targetCoords) {
            finalComments = finalComments.map((c: any) => {
                if (c.type === 'LOCATION_ADDED' && c.location && (!c.verificationStatus || c.autoVerified)) {
                    const submittedCoords = extractCoords(c.location)
                    if (submittedCoords) {
                        const distance = calculateDistance(targetCoords, submittedCoords)
                        c.verificationStatus = distance <= 100 ? 'CORRECT' : 'WRONG'
                        c.autoVerified = true
                    }
                }
                return c
            })
        }
    }

    const task = await prisma.task.update({
        where: { id: params.id },
        data: {
            title, description,
            assignees: { set: finalAssigneeIds.map(id => ({ id })) },
            deadline: deadlineDate,
            difficulty, location,
            attachments: attachments ? (typeof attachments === 'string' ? attachments : JSON.stringify(attachments)) : null,
            isEdited: true,
            comments: JSON.stringify(finalComments)
        }
    })

    await prisma.notification.createMany({
        data: finalAssigneeIds.map(id => ({
            userId: id,
            type: 'TASK_UPDATED',
            message: `Task "${title}" updated by ${userRole} ${session.user.name}.`,
            relatedId: task.id
        }))
    })

    return NextResponse.json(task)
}, {
    audit: { action: 'UPDATE_TASK_DETAILS', entityType: 'TASK', getEntityId: (res) => res.id }
})
