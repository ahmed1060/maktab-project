import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const [requests, total] = await Promise.all([
        prisma.dayOffRequest.findMany({
            where: { userId: session.user.id },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        prisma.dayOffRequest.count({ where: { userId: session.user.id } })
    ])

    return NextResponse.json({
        data: requests,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, body) => {
    const { date, endDate, type, reason } = body

    if (!date || !type) {
        return new NextResponse("Missing required fields", { status: 400 })
    }

    if (reason && reason.length > 100) {
        return new NextResponse("Reason must be 100 characters or less", { status: 400 })
    }

    const requestDateStr = new Date(date).toISOString().split('T')[0]
    const finalEndDateStr = endDate ? new Date(endDate).toISOString().split('T')[0] : requestDateStr

    if (type === 'REGULAR' && finalEndDateStr < requestDateStr) {
        return new NextResponse("End date cannot be before start date", { status: 400 })
    }

    const newRequest = await prisma.dayOffRequest.create({
        data: {
            userId: session.user.id,
            date: new Date(requestDateStr),
            endDate: (type === 'REGULAR' && finalEndDateStr !== requestDateStr) ? new Date(finalEndDateStr) : null,
            type,
            reason: reason || null,
            status: 'PENDING'
        }
    })

    // Notify Admins
    const admins = await prisma.user.findMany({
        where: {
            OR: [
                { role: 'ADMIN', companyId: session.user.companyId },
                { role: 'SUPER_ADMIN' }
            ]
        },
        select: { id: true }
    })

    const dateDisplay = finalEndDateStr === requestDateStr
        ? new Date(requestDateStr).toLocaleDateString()
        : `${new Date(requestDateStr).toLocaleDateString()} to ${new Date(finalEndDateStr).toLocaleDateString()}`

    for (const admin of admins) {
        await prisma.notification.create({
            data: {
                userId: admin.id,
                type: 'DAY_OFF_REQUEST',
                message: `${session.user.name} has requested a ${type.toLowerCase()} day off on ${dateDisplay}.`,
                relatedId: newRequest.id
            }
        })
    }

    return NextResponse.json(newRequest)
}, {
    audit: {
        action: 'CREATE_DAY_OFF',
        entityType: 'DAY_OFF_REQUEST',
        getEntityId: (res) => res.id
    }
})
