import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const requests = await prisma.dayOffRequest.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(requests)
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

        const requestDate = new Date(date)
        requestDate.setHours(0, 0, 0, 0)

        const finalEndDate = endDate ? new Date(endDate) : new Date(date)
        finalEndDate.setHours(23, 59, 59, 999)

        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const tomorrow = new Date(today)
        tomorrow.setDate(today.getDate() + 1)

        const yesterday = new Date(today)
        yesterday.setDate(today.getDate() - 1)

        if (type === 'REGULAR') {
            if (requestDate < tomorrow) {
                return new NextResponse("Regular day off must start from tomorrow or later", { status: 400 })
            }
            if (finalEndDate < requestDate) {
                return new NextResponse("End date cannot be before start date", { status: 400 })
            }
        } else if (type === 'CASUAL') {
            // Casual must be yesterday, today, or tomorrow
            if (requestDate < yesterday || requestDate > tomorrow) {
                return new NextResponse("Casual day off must be for yesterday, today, or tomorrow only", { status: 400 })
            }
            // Casual is usually single day, so we ignore endDate or enforce it's same as date
        }

        const newRequest = await prisma.dayOffRequest.create({
            data: {
                userId: session.user.id,
                date: requestDate,
                endDate: type === 'REGULAR' ? finalEndDate : null,
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

        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    userId: admin.id,
                    type: 'DAY_OFF_REQUEST',
                    message: `${session.user.name} has requested a ${type.toLowerCase()} day off on ${requestDate.toLocaleDateString()}.`,
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
