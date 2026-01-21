import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/lib/auth"
import { getEgyptTodayStr } from "@/lib/time"

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(request.url)
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
}

export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const body = await request.json()
        const { date, endDate, type, reason } = body

        if (!date || !type) {
            return new NextResponse("Missing required fields", { status: 400 })
        }

        if (reason && reason.length > 100) {
            return new NextResponse("Reason must be 100 characters or less", { status: 400 })
        }

        getEgyptTodayStr();

        const requestDateStr = new Date(date).toISOString().split('T')[0];
        const finalEndDateStr = endDate ? new Date(endDate).toISOString().split('T')[0] : requestDateStr;

        if (type === 'REGULAR') {
            if (finalEndDateStr < requestDateStr) {
                return new NextResponse("End date cannot be before start date", { status: 400 })
            }
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
            : `${new Date(requestDateStr).toLocaleDateString()} to ${new Date(finalEndDateStr).toLocaleDateString()}`;

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
    } catch (error) {
        console.error('Error creating day off request:', error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}
