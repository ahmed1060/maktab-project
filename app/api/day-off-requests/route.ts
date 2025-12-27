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
        const { date, type, reason } = body

        if (!date || !type) {
            return new NextResponse("Missing required fields", { status: 400 })
        }

        const requestDate = new Date(date)
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        tomorrow.setHours(0, 0, 0, 0)

        if (requestDate < tomorrow) {
            return new NextResponse("Day off must start from tomorrow or later", { status: 400 })
        }

        const newRequest = await prisma.dayOffRequest.create({
            data: {
                userId: session.user.id,
                date: requestDate,
                type,
                reason: reason || null,
                status: 'PENDING'
            }
        })

        return NextResponse.json(newRequest)
    } catch (error) {
        console.error('Error creating day off request:', error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}
