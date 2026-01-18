import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const body = await request.json()
        const { newDays } = body

        if (newDays === undefined || isNaN(parseFloat(newDays))) {
            return new NextResponse("Invalid number of days", { status: 400 })
        }

        const days = parseFloat(newDays)

        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id: params.id },
            include: { user: true }
        })

        if (!requestToUpdate) {
            return new NextResponse("Request not found", { status: 404 })
        }

        if (requestToUpdate.status !== 'APPROVED' || requestToUpdate.deductionType !== 'CREDIT') {
            return new NextResponse("Only approved credit-deducted requests can be re-evaluated", { status: 400 })
        }

        const oldDays = requestToUpdate.daysDeducted || 0
        const diff = oldDays - days

        await prisma.$transaction(async (tx) => {
            // Update the request
            await tx.dayOffRequest.update({
                where: { id: params.id },
                data: { daysDeducted: days }
            })

            // Update user's credit
            await tx.user.update({
                where: { id: requestToUpdate.userId },
                data: {
                    dayOffCredit: {
                        increment: diff
                    }
                }
            })

            // Notification for user
            await tx.notification.create({
                data: {
                    userId: requestToUpdate.userId,
                    type: 'DAY_OFF_REEVALUATE',
                    message: `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been re-evaluated. Adjusted from ${oldDays} to ${days} days.`,
                    relatedId: params.id
                }
            })
        })

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Error re-evaluating day off request:', error)
        return new NextResponse(error.message || "Internal Server Error", { status: 500 })
    }
}
