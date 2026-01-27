import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { verifyResourceAccess } from "@/lib/security"

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const taskId = params.id
    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied", { status: 403 })
    }

    try {
        const { type, itemId } = await request.json()

        const task = await prisma.task.findUnique({
            where: { id: taskId }
        })

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 })
        }

        // Strictly only allow deletion if task is IN_PROGRESS
        const canDelete = task.status === 'IN_PROGRESS'
        if (!canDelete) {
            return NextResponse.json({ error: 'Individual item deletion is only allowed when task is IN_PROGRESS' }, { status: 403 })
        }

        const updateData: any = {}

        if (type === 'ATTACHMENT') {
            const attachments = task.attachments ? JSON.parse(task.attachments) : []
            // itemId is the URL of the attachment
            const attachmentToDelete = attachments.find((att: any) => att.url === itemId)

            if (attachmentToDelete) {
                const isAuthor = attachmentToDelete.uploadedById === session.user.id
                const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(session.user.role)
                if (!isAuthor && !isAdmin) {
                    return NextResponse.json({ error: 'Only the author can delete this attachment' }, { status: 403 })
                }
            }

            const newAttachments = attachments.filter((att: any) => att.url !== itemId)
            updateData.attachments = JSON.stringify(newAttachments)
        } else if (type === 'COST_ADDITION' || type === 'SUBMISSION_NOTE') {
            const comments = task.comments ? JSON.parse(task.comments) : []
            // itemId is the date/timestamp
            const itemToDelete = comments.find((c: any) => c.type === type && (c.date === itemId || c.timestamp === itemId))

            if (!itemToDelete) {
                return NextResponse.json({ error: 'Item not found' }, { status: 404 })
            }

            // Authorship check
            const isAuthor = itemToDelete.authorId === session.user.id
            const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(session.user.role)
            if (!isAuthor && !isAdmin) {
                return NextResponse.json({ error: `Only the author can delete this ${type.toLowerCase().replace('_', ' ')}` }, { status: 403 })
            }

            const newComments = comments.filter((c: any) => !(c.type === type && (c.date === itemId || c.timestamp === itemId)))
            updateData.comments = JSON.stringify(newComments)

            if (type === 'COST_ADDITION' && itemToDelete.amount) {
                updateData.totalCost = {
                    decrement: itemToDelete.amount
                }

                // Also decrement from memberCosts if authorId exists
                if (itemToDelete.authorId) {
                    try {
                        let currentMemberCosts: Record<string, number> = {}
                        if (task.memberCosts) {
                            currentMemberCosts = typeof task.memberCosts === 'string'
                                ? JSON.parse(task.memberCosts)
                                : (task.memberCosts as Record<string, number>)
                        }

                        if (currentMemberCosts[itemToDelete.authorId]) {
                            currentMemberCosts[itemToDelete.authorId] -= itemToDelete.amount
                            // Ensure it doesn't go below zero
                            if (currentMemberCosts[itemToDelete.authorId] < 0) {
                                currentMemberCosts[itemToDelete.authorId] = 0
                            }
                            updateData.memberCosts = JSON.stringify(currentMemberCosts)
                        }
                    } catch (err) {
                        console.error('[MEMBER_COSTS_DECREMENT_ERROR]', err)
                    }
                }
            }
        } else {
            return NextResponse.json({ error: 'Invalid item type' }, { status: 400 })
        }

        await prisma.task.update({
            where: { id: taskId },
            data: updateData
        })

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Task item deletion failed:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
