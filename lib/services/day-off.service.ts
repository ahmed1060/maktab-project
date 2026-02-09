import { prisma } from "@/lib/prisma"
import { CreateDayOffInput, AdminUpdateDayOffInput } from "../validations/day-off.schema"

export class DayOffService {
    static async getMany(userId: string, skip: number, take: number) {
        const [requests, total] = await Promise.all([
            prisma.dayOffRequest.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take
            }),
            prisma.dayOffRequest.count({ where: { userId } })
        ])

        return { requests, total }
    }

    static async create(input: CreateDayOffInput, session: any) {
        const userId = session.user.id
        const userCompanyId = session.user.companyId
        const userName = session.user.name

        const requestDateStr = new Date(input.date).toISOString().split('T')[0]
        const finalEndDateStr = input.endDate ? new Date(input.endDate).toISOString().split('T')[0] : requestDateStr

        const todayStr = new Date().toISOString().split('T')[0]
        if (requestDateStr < todayStr) {
            throw new Error("DATE_IN_PAST")
        }

        if (input.type === 'REGULAR' && finalEndDateStr < requestDateStr) {
            throw new Error("END_DATE_BEFORE_START")
        }

        return await prisma.$transaction(async (tx) => {
            const newRequest = await tx.dayOffRequest.create({
                data: {
                    userId,
                    date: new Date(requestDateStr),
                    endDate: (input.type === 'REGULAR' && finalEndDateStr !== requestDateStr) ? new Date(finalEndDateStr) : null,
                    type: input.type,
                    reason: input.reason || null,
                    status: 'PENDING'
                }
            })

            // Notify Admins
            const admins = await tx.user.findMany({
                where: {
                    OR: [
                        { role: 'ADMIN', companyId: userCompanyId },
                        { role: 'SUPER_ADMIN' }
                    ]
                },
                select: { id: true }
            })

            const dateDisplay = finalEndDateStr === requestDateStr
                ? new Date(requestDateStr).toLocaleDateString()
                : `${new Date(requestDateStr).toLocaleDateString()} to ${new Date(finalEndDateStr).toLocaleDateString()}`

            if (admins.length > 0) {
                await tx.notification.createMany({
                    data: admins.map(admin => ({
                        userId: admin.id,
                        type: 'DAY_OFF_REQUEST',
                        message: `${userName} has requested a ${input.type.toLowerCase()} day off on ${dateDisplay}.`,
                        relatedId: newRequest.id
                    }))
                })
            }

            // Audit Log
            await tx.auditLog.create({
                data: {
                    action: 'CREATE_DAY_OFF_REQUEST',
                    entityType: 'DAY_OFF_REQUEST',
                    entityId: newRequest.id,
                    userId,
                    superAdminId: null,
                    details: JSON.stringify({ date: requestDateStr, endDate: finalEndDateStr, type: input.type })
                }
            })

            return newRequest
        })
    }

    static async approve(id: string, input: AdminUpdateDayOffInput, session: any) {
        const userRole = session.user.role
        const { daysToDeduct, deductionType } = input

        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id },
            include: { user: true }
        })

        if (!requestToUpdate) throw new Error("REQUEST_NOT_FOUND")

        // Authorization & Isolation
        if (userRole !== 'SUPER_ADMIN' && requestToUpdate.user.companyId !== session.user.companyId) {
            throw new Error("ACCESS_DENIED")
        }

        const updateData: any = { status: 'APPROVED' }

        return await prisma.$transaction(async (tx) => {
            if (daysToDeduct !== undefined) {
                const deduction = parseFloat(daysToDeduct.toString())
                if (isNaN(deduction)) throw new Error("INVALID_DEDUCTION")

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
                            reason: `Day off deduction for request #${id}`,
                            status: 'ACTIVE'
                        }
                    })
                } else {
                    const currentUser = await tx.user.findUnique({
                        where: { id: requestToUpdate.userId },
                        select: { dayOffCredit: true }
                    })
                    if (!currentUser || currentUser.dayOffCredit < deduction) {
                        throw new Error("INSUFFICIENT_CREDIT")
                    }
                    await tx.user.update({
                        where: { id: requestToUpdate.userId },
                        data: { dayOffCredit: { decrement: deduction } }
                    })
                }
            }

            const updatedRequest = await tx.dayOffRequest.update({
                where: { id },
                data: updateData
            })

            // Audit Log
            await tx.auditLog.create({
                data: {
                    action: 'APPROVE_DAY_OFF_REQUEST',
                    entityType: 'DAY_OFF_REQUEST',
                    entityId: id,
                    userId: userRole !== 'SUPER_ADMIN' ? (session.user as any).id : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? (session.user as any).id : null,
                    details: JSON.stringify({ daysToDeduct: input.daysToDeduct, deductionType: input.deductionType })
                }
            })

            await tx.notification.create({
                data: {
                    userId: requestToUpdate.userId,
                    type: 'DAY_OFF_RESULT',
                    message: `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been approved${input.deductionType === 'SALARY' ? ' (deducted from salary)' : ''}.`,
                    relatedId: id
                }
            })

            return updatedRequest
        })
    }

    static async reject(id: string, session: any) {
        const userRole = session.user.role
        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id },
            include: { user: true }
        })

        if (!requestToUpdate) throw new Error("REQUEST_NOT_FOUND")

        if (userRole !== 'SUPER_ADMIN' && requestToUpdate.user.companyId !== session.user.companyId) {
            throw new Error("ACCESS_DENIED")
        }

        const result = await prisma.dayOffRequest.update({
            where: { id },
            data: { status: 'REJECTED' }
        })

        // Audit Log
        await prisma.auditLog.create({
            data: {
                action: 'REJECT_DAY_OFF_REQUEST',
                entityType: 'DAY_OFF_REQUEST',
                entityId: id,
                userId: userRole !== 'SUPER_ADMIN' ? (session.user as any).id : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? (session.user as any).id : null,
                details: null
            }
        })

        await prisma.notification.create({
            data: {
                userId: requestToUpdate.userId,
                type: 'DAY_OFF_RESULT',
                message: `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been rejected.`,
                relatedId: id
            }
        })

        return result
    }

    static async reevaluate(id: string, newDays: number, session: any) {
        const userRole = session.user.role
        if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) throw new Error("ACCESS_DENIED")

        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id },
            include: { user: true }
        })

        if (!requestToUpdate) throw new Error("REQUEST_NOT_FOUND")

        if (userRole !== 'SUPER_ADMIN' && requestToUpdate.user.companyId !== session.user.companyId) {
            throw new Error("ACCESS_DENIED")
        }

        if (requestToUpdate.status !== 'APPROVED' || requestToUpdate.deductionType !== 'CREDIT') {
            throw new Error("INVALID_STATE")
        }

        const oldDays = requestToUpdate.daysDeducted || 0
        const diff = oldDays - newDays

        return await prisma.$transaction(async (tx) => {
            await tx.dayOffRequest.update({
                where: { id },
                data: { daysDeducted: newDays }
            })

            // Audit Log
            await tx.auditLog.create({
                data: {
                    action: 'REEVALUATE_DAY_OFF_REQUEST',
                    entityType: 'DAY_OFF_REQUEST',
                    entityId: id,
                    userId: userRole !== 'SUPER_ADMIN' ? (session.user as any).id : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? (session.user as any).id : null,
                    details: JSON.stringify({ oldDays, newDays })
                }
            })

            await tx.user.update({
                where: { id: requestToUpdate.userId },
                data: { dayOffCredit: { increment: diff } }
            })

            await tx.notification.create({
                data: {
                    userId: requestToUpdate.userId,
                    type: 'DAY_OFF_REEVALUATE',
                    message: `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been re-evaluated. Adjusted from ${oldDays} to ${newDays} days.`,
                    relatedId: id
                }
            })

            return { success: true }
        })
    }
}
