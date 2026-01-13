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
        const { status, daysToDeduct, deductionType } = body

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
                updateData.deductionType = deductionType || 'CREDIT'

                if (deductionType === 'SALARY') {
                    const now = new Date()
                    const currentMonth = now.getMonth() + 1
                    const currentYear = now.getFullYear()

                    const existingRecord = await tx.salaryRecord.findUnique({
                        where: { userId_month_year: { userId: requestToUpdate.userId, month: currentMonth, year: currentYear } }
                    })

                    if (existingRecord) {
                        await tx.salaryRecord.update({
                            where: { id: existingRecord.id },
                            data: { deductions: { increment: deduction } }
                        })
                    } else {
                        const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
                        await tx.salaryRecord.create({
                            data: {
                                userId: requestToUpdate.userId,
                                month: currentMonth,
                                year: currentYear,
                                totalDays: daysInMonth,
                                deductions: deduction,
                                baseSalary: requestToUpdate.user.salary || 0,
                                bonusDays: 0
                            }
                        })
                    }

                    await tx.salaryAdjustment.create({
                        data: {
                            userId: requestToUpdate.userId,
                            type: 'DEDUCTION',
                            amount: deduction,
                            reason: `Day off deduction for request #${params.id}`,
                            status: 'ACTIVE'
                        }
                    })
                } else {
                    // SECURE: Check if user has enough credit before deducting
                    const currentUser = await tx.user.findUnique({
                        where: { id: requestToUpdate.userId },
                        select: { dayOffCredit: true }
                    })

                    if (!currentUser || currentUser.dayOffCredit < deduction) {
                        throw new Error(`Insufficient day off credit. Available: ${currentUser?.dayOffCredit || 0}, Required: ${deduction}`)
                    }

                    await tx.user.update({
                        where: { id: requestToUpdate.userId },
                        data: {
                            dayOffCredit: {
                                decrement: deduction
                            }
                        }
                    })
                }
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
                    message: `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been ${status.toLowerCase()}${deductionType === 'SALARY' ? ' (deducted from salary)' : ''}.`,
                    relatedId: params.id
                }
            })

            return updatedRequest
        })

        return NextResponse.json(result)
    } catch (error: any) {
        console.error('Error updating day off request:', error)
        const isClientError = error.message?.includes('Insufficient') || error.message?.includes('Invalid')
        return new NextResponse(error.message || "Internal Server Error", {
            status: isClientError ? 400 : 500
        })
    }
}
