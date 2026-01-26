import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const PATCH = withStandardHandler(async (req, session, body, { params }) => {
    const requestId = params.id
    const userRole = session.user.role

    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { status, daysToDeduct, deductionType } = body
    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
        return new NextResponse("Invalid status", { status: 400 })
    }

    const requestToUpdate = await prisma.dayOffRequest.findUnique({
        where: { id: requestId },
        include: { user: true }
    })

    if (!requestToUpdate) return new NextResponse("Request not found", { status: 404 })

    if (userRole !== 'SUPER_ADMIN' && requestToUpdate.user.companyId !== session.user.companyId) {
        return new NextResponse("Access denied", { status: 403 })
    }

    const updateData: any = { status }

    const result = await prisma.$transaction(async (tx) => {
        if (status === 'APPROVED' && daysToDeduct !== undefined) {
            const deduction = parseFloat(daysToDeduct)
            if (isNaN(deduction)) throw new Error("Invalid deduction amount")

            updateData.daysDeducted = deduction
            updateData.deductionType = deductionType || 'CREDIT'

            if (deductionType === 'SALARY') {
                const now = new Date()
                const m = now.getMonth() + 1, y = now.getFullYear()

                const existingRecord = await tx.salaryRecord.findUnique({
                    where: { userId_month_year: { userId: requestToUpdate.userId, month: m, year: y } }
                })

                if (existingRecord) {
                    await tx.salaryRecord.update({
                        where: { id: existingRecord.id },
                        data: { deductions: { increment: deduction } }
                    })
                } else {
                    await tx.salaryRecord.create({
                        data: {
                            userId: requestToUpdate.userId,
                            month: m, year: y,
                            totalDays: new Date(y, m, 0).getDate(),
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
                        reason: `Day off deduction for request #${requestId}`,
                        status: 'ACTIVE'
                    }
                })
            } else {
                const currentUser = await tx.user.findUnique({
                    where: { id: requestToUpdate.userId },
                    select: { dayOffCredit: true }
                })
                if (!currentUser || currentUser.dayOffCredit < deduction) {
                    throw new Error(`Insufficient credit. Available: ${currentUser?.dayOffCredit || 0}, Required: ${deduction}`)
                }
                await tx.user.update({
                    where: { id: requestToUpdate.userId },
                    data: { dayOffCredit: { decrement: deduction } }
                })
            }
        }

        const updatedRequest = await tx.dayOffRequest.update({
            where: { id: requestId },
            data: updateData
        })

        await tx.notification.create({
            data: {
                userId: requestToUpdate.userId,
                type: 'DAY_OFF_RESULT',
                message: `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been ${status.toLowerCase()}${deductionType === 'SALARY' ? ' (deducted from salary)' : ''}.`,
                relatedId: requestId
            }
        })

        return updatedRequest
    })

    return NextResponse.json(result)
}, {
    audit: { action: 'APPROVE_DAY_OFF', entityType: 'DAY_OFF_REQUEST', getEntityId: (res) => res.id }
})
