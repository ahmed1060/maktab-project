import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const body = await request.json()
        const { status, daysToDeduct } = body

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return new NextResponse("Invalid status", { status: 400 })
        }

        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id: params.id },
            include: { user: true }
        })

        if (!requestToUpdate) {
            return new NextResponse("Request not found", { status: 404 })
        }

        // Authorization check
        if (session.user.role !== 'SUPER_ADMIN') {
            if (requestToUpdate.user.companyId !== session.user.companyId) {
                return new NextResponse("Access denied", { status: 403 })
            }
        }

        const updateData: any = { status }

        // Start transaction for atomicity
        const result = await prisma.$transaction(async (tx) => {
            if (status === 'APPROVED' && daysToDeduct !== undefined) {
                const deduction = parseFloat(daysToDeduct)
                if (isNaN(deduction)) {
                    throw new Error("Invalid deduction amount")
                }

                updateData.daysDeducted = deduction

                await tx.user.update({
                    where: { id: requestToUpdate.userId },
                    data: {
                        dayOffCredit: {
                            decrement: deduction
                        }
                    }
                })
            }

            const updatedRequest = await tx.dayOffRequest.update({
                where: { id: params.id },
                data: updateData
            })

            // Notification for user
            await tx.notification.create({
                data: {
                    userId: requestToUpdate.userId,
                    type: 'DAY_OFF_RESULT',
                    message: `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been ${status.toLowerCase()}.`,
                    relatedId: params.id
                }
            })

            return updatedRequest
        })

        return NextResponse.json(result)
    } catch (error: any) {
        console.error('Error updating day off request:', error)
        return new NextResponse(error.message || "Internal Server Error", { status: 500 })
    }
}
