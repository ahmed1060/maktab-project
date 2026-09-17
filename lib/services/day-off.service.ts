import { prisma } from "@/lib/prisma"
import { CreateDayOffInput, AdminUpdateDayOffInput } from "../validations/day-off.schema"
import { calendarMonth } from "@/lib/time"

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
            // --- NEW: Overlap Protection ---
            const overlap = await tx.dayOffRequest.findFirst({
                where: {
                    userId,
                    status: { in: ['PENDING', 'APPROVED'] },
                    OR: [
                        { // Start date inside existing range
                            date: { lte: new Date(finalEndDateStr) },
                            endDate: { gte: new Date(requestDateStr) }
                        },
                        { // No endDate means it's a single day
                            date: { gte: new Date(requestDateStr), lte: new Date(finalEndDateStr) },
                            endDate: null
                        }
                    ]
                }
            })
            if (overlap) throw new Error("OVERLAPPING_REQUEST")

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
            // ... (rest of notification and audit logic unchanged)
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

            // Notify Admins (Centralized)
            const { NotificationService } = await import("./notification.service")
            await NotificationService.notifyMany(
                admins.map(admin => admin.id),
                'DAY_OFF_REQUEST',
                `${userName} has requested a ${input.type.toLowerCase()} day off on ${dateDisplay}.`,
                newRequest.id,
                tx
            )

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('CREATE_DAY_OFF_REQUEST', 'DAY_OFF_REQUEST', newRequest.id, {
                tx,
                userId,
                details: { date: requestDateStr, endDate: finalEndDateStr, type: input.type }
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
        if (requestToUpdate.status !== 'PENDING') throw new Error("INVALID_STATUS")

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
                    const { month: m, year: y } = calendarMonth(now)

                    // USE CONSOLIDATED HELPER
                    const { SalaryService } = await import("./salary.service")
                    const record = await SalaryService.ensureRecordExists(requestToUpdate.userId, m, y, requestToUpdate.user.salary || 0, tx)

                    await tx.salaryRecord.update({
                        where: { id: record.id },
                        data: { deductions: { increment: deduction } }
                    })

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
                    // CONCURRENCY SAFE CREDIT DEDUCTION
                    const updatedUser = await tx.user.update({
                        where: {
                            id: requestToUpdate.userId,
                            dayOffCredit: { gte: deduction } // Atomic guard
                        },
                        data: { dayOffCredit: { decrement: deduction } }
                    })
                    if (!updatedUser) throw new Error("INSUFFICIENT_CREDIT")
                }
            }

            const updatedRequest = await tx.dayOffRequest.update({
                where: { id },
                data: updateData
            })

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('APPROVE_DAY_OFF_REQUEST', 'DAY_OFF_REQUEST', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? (session.user as any).id : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? (session.user as any).id : null,
                details: {
                    daysToDeduct: input.daysToDeduct,
                    deductionType: input.deductionType,
                    requestDate: requestToUpdate.date,
                    userName: requestToUpdate.user.firstName + (requestToUpdate.user.lastName ? ' ' + requestToUpdate.user.lastName : '')
                }
            })

            const { NotificationService } = await import("./notification.service")
            await NotificationService.notify(
                requestToUpdate.userId,
                'DAY_OFF_RESULT',
                `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been approved${input.deductionType === 'SALARY' ? ' (deducted from salary)' : ''}.`,
                id,
                tx
            )

            return updatedRequest
        })
    }

    static async reject(id: string, session: any, rejectionReason?: string) {
        const userRole = session.user.role
        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id },
            include: { user: true }
        })

        if (!requestToUpdate) throw new Error("REQUEST_NOT_FOUND")
        if (requestToUpdate.status !== 'PENDING') throw new Error("INVALID_STATUS")

        if (userRole !== 'SUPER_ADMIN' && requestToUpdate.user.companyId !== session.user.companyId) {
            throw new Error("ACCESS_DENIED")
        }

        // An empty textarea arrives as "" — store null so the UI's
        // "was a reason given?" check is a simple truthiness test.
        const trimmedReason = rejectionReason?.trim() || null

        const result = await prisma.dayOffRequest.update({
            where: { id },
            data: { status: 'REJECTED', rejectionReason: trimmedReason }
        })

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('REJECT_DAY_OFF_REQUEST', 'DAY_OFF_REQUEST', id, {
            userId: userRole !== 'SUPER_ADMIN' ? (session.user as any).id : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? (session.user as any).id : null,
            details: {
                date: requestToUpdate.date,
                userName: requestToUpdate.user.firstName + (requestToUpdate.user.lastName ? ' ' + requestToUpdate.user.lastName : ''),
                rejectionReason: trimmedReason
            }
        })

        await prisma.notification.create({
            data: {
                userId: requestToUpdate.userId,
                type: 'DAY_OFF_RESULT',
                message: `Your day off request for ${new Date(requestToUpdate.date).toLocaleDateString()} has been rejected.${trimmedReason ? ` Reason: ${trimmedReason}` : ''}`,
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
        if (requestToUpdate.status !== 'APPROVED') throw new Error("INVALID_STATE")

        if (userRole !== 'SUPER_ADMIN' && requestToUpdate.user.companyId !== session.user.companyId) {
            throw new Error("ACCESS_DENIED")
        }

        const oldDays = requestToUpdate.daysDeducted || 0
        const diff = oldDays - newDays

        return await prisma.$transaction(async (tx) => {
            await tx.dayOffRequest.update({
                where: { id },
                data: { daysDeducted: newDays }
            })

            if (requestToUpdate.deductionType === 'SALARY') {
                // Adjust Salary Deduction
                const adj = await tx.salaryAdjustment.findFirst({
                    where: { userId: requestToUpdate.userId, reason: { contains: id }, status: 'ACTIVE' }
                })
                if (adj) {
                    await tx.salaryAdjustment.update({
                        where: { id: adj.id },
                        data: { amount: newDays }
                    })
                    // Also update the record (diff)
                    const date = new Date(adj.createdAt)
                    const { month: m, year: y } = calendarMonth(date)
                    const record = await tx.salaryRecord.findUnique({ where: { userId_month_year: { userId: requestToUpdate.userId, month: m, year: y } } })
                    if (record) {
                        await tx.salaryRecord.update({
                            where: { id: record.id },
                            data: { deductions: { decrement: diff } }
                        })
                    }
                }
            } else {
                // Adjust Credit
                if (diff < 0) { // Increasing deduction, check if user has enough credit
                    const guardCheck = await tx.user.update({
                        where: {
                            id: requestToUpdate.userId,
                            dayOffCredit: { gte: Math.abs(diff) }
                        },
                        data: { dayOffCredit: { increment: diff } }
                    })
                    if (!guardCheck) throw new Error("INSUFFICIENT_CREDIT")
                } else {
                    await tx.user.update({
                        where: { id: requestToUpdate.userId },
                        data: { dayOffCredit: { increment: diff } }
                    })
                }
            }

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('REEVALUATE_DAY_OFF_REQUEST', 'DAY_OFF_REQUEST', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? (session.user as any).id : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? (session.user as any).id : null,
                details: {
                    oldDays,
                    newDays,
                    deductionType: requestToUpdate.deductionType,
                    userName: requestToUpdate.user.firstName + (requestToUpdate.user.lastName ? ' ' + requestToUpdate.user.lastName : '')
                }
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
