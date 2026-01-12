import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { verifyResourceAccess } from "@/lib/security"

export async function PUT(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    try {
        const { timestamp, action, verificationStatus } = await request.json()
        const taskId = params.id

        const task = await prisma.task.findUnique({
            where: { id: taskId }
        })

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 })
        }

        const comments = task.comments ? JSON.parse(task.comments) : []
        const locationIndex = comments.findIndex((c: any) => c.type === 'LOCATION_ADDED' && c.date === timestamp)

        if (locationIndex === -1) {
            return NextResponse.json({ error: 'Location entry not found' }, { status: 404 })
        }

        if (action === 'VERIFY') {
            comments[locationIndex].verificationStatus = verificationStatus
        } else if (action === 'DELETE') {
            // Check permissions for delete
            // User can delete if they are the author AND task is editable (PENDING/REJECTED)
            // OR if they are ADMIN/SUPER_ADMIN/TEAM_LEADER
            const isAuthor = comments[locationIndex].author === session.user.name || comments[locationIndex].authorId === session.user.id
            const canEditTask = task.status === 'PENDING' || task.status === 'REJECTED' || task.status === 'IN_PROGRESS' // Assuming IN_PROGRESS maps to active work state

            // Allow if admin or (author and editable)
            const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(session.user.role)

            if (isAdmin || (isAuthor && canEditTask)) {
                comments.splice(locationIndex, 1)
            } else {
                return NextResponse.json({ error: 'Not authorized to delete this location' }, { status: 403 })
            }
        }

        await prisma.task.update({
            where: { id: taskId },
            data: {
                comments: JSON.stringify(comments)
            }
        })

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Location update failed:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    try {
        const body = await request.json()
        const dateToDelete = body.date || body.timestamp
        const taskId = params.id

        if (!dateToDelete) {
            return NextResponse.json({ error: 'Date/Timestamp is required' }, { status: 400 })
        }

        const task = await prisma.task.findUnique({
            where: { id: taskId }
        })

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 })
        }

        const comments = task.comments ? JSON.parse(task.comments) : []
        const locationIndex = comments.findIndex((c: any) => c.type === 'LOCATION_ADDED' && c.date === dateToDelete)

        if (locationIndex === -1) {
            return NextResponse.json({ error: 'Location entry not found' }, { status: 404 })
        }

        if (task.status === 'IN_PROGRESS') {
            comments.splice(locationIndex, 1)
        } else {
            return NextResponse.json({ error: 'Location deletion is only allowed when task is IN_PROGRESS' }, { status: 403 })
        }

        await prisma.task.update({
            where: { id: taskId },
            data: {
                comments: JSON.stringify(comments)
            }
        })

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Location deletion failed:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 })
    }
}
