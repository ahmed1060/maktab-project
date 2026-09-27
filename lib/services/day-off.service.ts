import { prisma } from "@/lib/prisma"
import { noticeRow } from "@/lib/notice-row"
import { optional } from "@/lib/notice"
import { can, type Target } from "@/lib/permissions/can"
import { holdersOf } from "@/lib/permissions/holders"
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
            const requesterLeaderId = (await tx.user.findUnique({ where: { id: userId }, select: { teamLeaderId: true } }))?.teamLeaderId
            const admins = await tx.user.findMany({
                where: {
                    // Whoever can decide it: everyone in this company whose role
                    // holds dayoff.approve company-wide, the requester's own
                    // leader if theirs holds it for their team, and every
                    // Super Admin.
                    OR: [
                        { companyId: userCompanyId, ...holdersOf("dayoff.approve", "COMPANY") },
                        ...(requesterLeaderId ? [{ id: requesterLeaderId, companyId: userCompanyId, ...holdersOf("dayoff.approve", "TEAM") }] : []),
                        { role: 'SUPER_ADMIN' }
                    ]
                },
                select: { id: true }
            })

            const from = { date: new Date(requestDateStr).toISOString() }
            const when = finalEndDateStr === requestDateStr
                ? from
                : { key: 'notice_date_range' as const, params: { from, to: { date: new Date(finalEndDateStr).toISOString() } } }

            // Notify Admins (Centralized)
            const { NotificationService } = await import("./notification.service")
            await NotificationService.notifyMany(
                admins.map(admin => admin.id),
                'DAY_OFF_REQUEST',
                { key: 'notice_dayoff_requested', params: { name: userName, type: { key: `notice_dayoff_type_${input.type}` }, when } },
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
        // Only for attributing the audit entry — who may act is can()'s.
        const userRole = session.user.role
        const { daysToDeduct, deductionType } = input

        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id },
            include: { user: true }
        })

        if (!requestToUpdate) throw new Error("REQUEST_NOT_FOUND")
        if (requestToUpdate.status !== 'PENDING') throw new Error("INVALID_STATUS")

        // Authorization & Isolation
        if (!can(session.user, "dayoff.approve", personOf(requestToUpdate.user))) {
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
                    // One call: it ensures the month's record, increments it,
                    // and writes the adjustment with its period and the request
                    // it came from. The sourceId is what replaces finding this
                    // row again by substring-matching its reason text.
                    const { SalaryService } = await import("./salary.service")
                    await SalaryService.applyAdjustment({
                        userId: requestToUpdate.userId,
                        type: 'DEDUCTION',
                        amount: deduction,
                        source: 'DAY_OFF',
                        sourceId: id,
                        reason: `Day off deduction for request #${id}`,
                        baseSalary: requestToUpdate.user.salary || 0,
                    }, tx)
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
                { key: 'notice_dayoff_approved', params: { date: { date: new Date(requestToUpdate.date).toISOString() }, salary: optional('notice_dayoff_from_salary', {}, input.deductionType === 'SALARY') } },
                id,
                tx
            )

            return updatedRequest
        })
    }

    static async reject(id: string, session: any, rejectionReason?: string) {
        // Only for attributing the audit entry — who may act is can()'s.
        const userRole = session.user.role
        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id },
            include: { user: true }
        })

        if (!requestToUpdate) throw new Error("REQUEST_NOT_FOUND")
        if (requestToUpdate.status !== 'PENDING') throw new Error("INVALID_STATUS")

        if (!can(session.user, "dayoff.approve", personOf(requestToUpdate.user))) {
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
                ...noticeRow({ key: 'notice_dayoff_rejected', params: { date: { date: new Date(requestToUpdate.date).toISOString() }, reason: optional('notice_reason_suffix', { reason: trimmedReason ?? '' }, trimmedReason) } }),
                relatedId: id
            }
        })

        return result
    }

    static async reevaluate(id: string, newDays: number, session: any) {
        // Only for attributing the audit entry — who may act is can()'s.
        const userRole = session.user.role
        if (!can(session.user, "dayoff.approve")) throw new Error("ACCESS_DENIED")

        const requestToUpdate = await prisma.dayOffRequest.findUnique({
            where: { id },
            include: { user: true }
        })

        if (!requestToUpdate) throw new Error("REQUEST_NOT_FOUND")
        if (requestToUpdate.status !== 'APPROVED') throw new Error("INVALID_STATE")

        if (!can(session.user, "dayoff.approve", personOf(requestToUpdate.user))) {
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
                // Found by where it came from, not by substring-matching a free
                // text field an admin can edit. `reason: { contains: id }` also
                // matched any other adjustment whose reason happened to contain
                // this request's id, and silently did nothing when it matched
                // none — leaving the salary record holding the old figure while
                // the request said the new one.
                const adj = await tx.salaryAdjustment.findFirst({
                    where: {
                        userId: requestToUpdate.userId,
                        source: 'DAY_OFF',
                        sourceId: id,
                        status: 'ACTIVE',
                    },
                    orderBy: { createdAt: 'desc' },
                })
                if (adj) {
                    await tx.salaryAdjustment.update({
                        where: { id: adj.id },
                        data: { amount: newDays }
                    })
                    // The month the days actually landed on, read off the row
                    // rather than re-derived from when it was written.
                    const record = await tx.salaryRecord.findUnique({
                        where: { userId_month_year: { userId: requestToUpdate.userId, month: adj.month, year: adj.year } }
                    })
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
                    ...noticeRow({ key: 'notice_dayoff_reevaluated', params: { date: { date: new Date(requestToUpdate.date).toISOString() }, from: oldDays, to: newDays } }),
                    relatedId: id
                }
            })

            return { success: true }
        })
    }
}

/** The request's owner as a can() target: their company, and who leads them. */
function personOf(user: { id: string; companyId: string | null; teamLeaderId: string | null }): Target {
    return { companyId: user.companyId, userId: user.id, teamLeaderId: user.teamLeaderId }
}
