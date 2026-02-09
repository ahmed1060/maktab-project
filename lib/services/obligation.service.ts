import { prisma } from "@/lib/prisma"
import { CreateObligationInput } from "../validations/obligation.schema"

export class ObligationService {
    static async create(input: CreateObligationInput, session: any) {
        const userRole = session.user.role
        const creatorCompanyId = (session.user as any).companyId
        const { title, description, assigneeIds, deadline, recurrence, difficulty, attachments } = input

        if (userRole === 'EMPLOYEE') throw new Error("EMPLOYEES_CANNOT_CREATE_OBLIGATIONS")

        // 1. Assignee & Company Validation
        if (userRole !== 'SUPER_ADMIN') {
            if (!creatorCompanyId) throw new Error("USER_NO_COMPANY")

            const assigneeUsers = await prisma.user.findMany({
                where: { id: { in: assigneeIds } },
                select: { id: true, companyId: true, role: true }
            })

            if (assigneeUsers.length !== assigneeIds.length) throw new Error("ASSIGNEE_NOT_FOUND")

            const externalAssignee = assigneeUsers.find(u => u.companyId !== creatorCompanyId)
            if (externalAssignee) throw new Error("CROSS_COMPANY_ASSIGNMENT_FORBIDDEN")

            if (userRole === 'TEAM_LEADER') {
                const adminAssignee = assigneeUsers.find(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))
                if (adminAssignee) throw new Error("TEAM_LEADER_CANNOT_ASSIGN_TO_ADMIN")
            }
        }

        // 2. Resolve Company ID
        let targetCompanyId = creatorCompanyId
        if (userRole === 'SUPER_ADMIN' && assigneeIds.length > 0) {
            const firstAssignee = await prisma.user.findUnique({
                where: { id: assigneeIds[0] },
                select: { companyId: true }
            })
            if (firstAssignee) targetCompanyId = firstAssignee.companyId
        }

        // 3. Create
        return await prisma.obligation.create({
            data: {
                title,
                description,
                companyId: targetCompanyId,
                assignees: {
                    connect: assigneeIds.map(id => ({ id }))
                },
                deadline: new Date(deadline),
                recurrence: recurrence || 'ONE_TIME',
                difficulty: difficulty || 0,
                attachments: attachments ? JSON.stringify(attachments) : null,
                status: 'PENDING'
            }
        })
    }

    static async update(id: string, input: any, session: any) {
        const { status, newAttachments, assigneeIds } = input
        const userId = session.user.id
        const userRole = session.user.role
        const userName = session.user.name

        return await prisma.$transaction(async (tx) => {
            const current = await tx.obligation.findUnique({
                where: { id },
                include: { assignees: true }
            })
            if (!current) throw new Error("OBLIGATION_NOT_FOUND")

            // 1. Authorization
            const isManager = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)
            const isAssignee = current.assignees.some((a: any) => a.id === userId)
            if (!isManager && !isAssignee) throw new Error("ACCESS_DENIED")

            // 2. Self-approval restriction
            if (status && ['APPROVED', 'REJECTED'].includes(status) && ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && isAssignee) {
                throw new Error("SELF_APPROVAL_FORBIDDEN")
            }

            // 3. Attachment logic
            let finalAttachments: any[] = []
            if (current.attachments) {
                try {
                    const parsed = JSON.parse(current.attachments)
                    finalAttachments = Array.isArray(parsed) ? parsed : [parsed]
                } catch { finalAttachments = [] }
            }

            // Merge/Remove attachments
            if (input.attachments && Array.isArray(input.attachments)) {
                const removedItems = finalAttachments.filter(old => !input.attachments.some((req: any) => (req.url || req) === (old.url || old)))
                if (removedItems.length > 0 && !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
                    if (removedItems.some(i => i.uploadedById !== userId)) throw new Error("UNAUTHORIZED_ATTACHMENT_REMOVAL")
                }
                finalAttachments = input.attachments
            }
            if (newAttachments && Array.isArray(newAttachments)) {
                finalAttachments = [...finalAttachments, ...newAttachments]
            }

            // 4. Update Data Preparation
            const updateData: any = {
                attachments: JSON.stringify(finalAttachments),
                ...(status && { status }),
                ...(['APPROVED', 'REJECTED', 'COMPLETED'].includes(status) && { lastStatusUpdateBy: `${userRole} ${userName}` })
            }

            // Reassignment
            if (assigneeIds && isManager) {
                if (userRole === 'TEAM_LEADER') {
                    const targetUsers = await tx.user.findMany({ where: { id: { in: assigneeIds } }, select: { role: true } })
                    if (targetUsers.some(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))) throw new Error("TL_CANNOT_REASSIGN_TO_ADMIN")
                }
                updateData.assignees = { set: assigneeIds.map((uid: string) => ({ id: uid })) }
            }

            const updated = await tx.obligation.update({
                where: { id },
                data: updateData,
                include: { assignees: true }
            })

            // 5. Point Delta Logic
            const hasPoints = (s: string) => ['APPROVED', 'COMPLETED'].includes(s)
            const oldHasPoints = hasPoints(current.status)
            const newHasPoints = hasPoints(status || current.status)

            if (!oldHasPoints && newHasPoints) {
                for (const a of updated.assignees) {
                    await tx.user.update({ where: { id: a.id }, data: { totalDifficultyPoints: { increment: updated.difficulty } } })
                }
            } else if (oldHasPoints && !newHasPoints) {
                for (const a of updated.assignees) {
                    await tx.user.update({ where: { id: a.id }, data: { totalDifficultyPoints: { decrement: updated.difficulty } } })
                }
            }

            // 6. Notifications
            if (['APPROVED', 'REJECTED'].includes(status)) {
                await tx.notification.createMany({
                    data: updated.assignees.map((a: any) => ({
                        userId: a.id,
                        type: status === 'APPROVED' ? 'OBLIGATION_APPROVED' : 'OBLIGATION_REJECTED',
                        message: `Your obligation "${updated.title}" has been ${status === 'APPROVED' ? 'approved' : 'rejected'}.`,
                        relatedId: id
                    }))
                })
            }

            return updated
        })
    }

    static async delete(id: string, session: any) {
        const userId = session.user.id
        const userRole = session.user.role

        if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) throw new Error("ACCESS_DENIED")

        return await prisma.$transaction(async (tx) => {
            const obligation = await tx.obligation.findUnique({
                where: { id },
                select: { status: true, difficulty: true, assignees: { select: { id: true } } }
            })

            if (!obligation) throw new Error("OBLIGATION_NOT_FOUND")

            // Self-delete rule
            const isSelfAssigned = obligation.assignees.some((a: any) => a.id === userId)
            if (['ADMIN', 'SUPER_ADMIN'].includes(userRole) && isSelfAssigned) throw new Error("ADMIN_CANNOT_DELETE_SELF_OBLIGATION")

            // Point deduction
            if (['APPROVED', 'COMPLETED'].includes(obligation.status)) {
                for (const a of obligation.assignees) {
                    await tx.user.update({
                        where: { id: a.id },
                        data: { totalDifficultyPoints: { decrement: obligation.difficulty } }
                    })
                }
            }

            await tx.obligation.delete({ where: { id } })
            return { id }
        })
    }

    /**
     * Reverts an obligation to IN_PROGRESS.
     */
    static async revert(id: string, session: any) {
        const userId = session.user.id
        const userName = session.user.name

        return await prisma.$transaction(async (tx) => {
            const obligation = await (tx.obligation as any).findUnique({
                where: { id },
                include: { assignees: { select: { id: true } } }
            }) as any

            if (!obligation) throw new Error("OBLIGATION_NOT_FOUND")
            if (!['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(obligation.status)) {
                throw new Error(`CANNOT_REVERT_STATUS_${obligation.status}`)
            }

            const hadPoints = ['APPROVED', 'COMPLETED'].includes(obligation.status)
            const pointDeduction = hadPoints ? obligation.difficulty : 0

            const updatedObligation = await tx.obligation.update({
                where: { id },
                data: {
                    status: 'IN_PROGRESS',
                    lastStatusUpdateBy: `SUPER_ADMIN ${userName}`
                }
            })

            if (pointDeduction > 0) {
                const assigneeIds = obligation.assignees.map((a: any) => a.id)
                await tx.user.updateMany({
                    where: { id: { in: assigneeIds } },
                    data: {
                        totalDifficultyPoints: {
                            decrement: pointDeduction
                        }
                    }
                })
            }

            await tx.notification.createMany({
                data: obligation.assignees.map((a: any) => ({
                    userId: a.id,
                    type: 'OBLIGATION_REVERTED',
                    message: `Super Admin has reverted obligation "${obligation.title}" back to In Progress.`,
                    relatedId: obligation.id
                }))
            })

            const isSuperAdminEntity = await tx.superAdmin.findUnique({ where: { id: userId } })
            await tx.auditLog.create({
                data: {
                    action: 'REVERT_OBLIGATION',
                    entityType: 'OBLIGATION',
                    entityId: obligation.id,
                    superAdminId: isSuperAdminEntity ? userId : null,
                    userId: isSuperAdminEntity ? null : userId,
                    details: JSON.stringify({
                        oldStatus: obligation.status,
                        newStatus: 'IN_PROGRESS',
                        pointsDeducted: pointDeduction
                    })
                }
            })

            return updatedObligation
        })
    }
}
