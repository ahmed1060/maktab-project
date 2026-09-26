import { prisma } from "@/lib/prisma"
import { can, canCompanyWide } from "@/lib/permissions/can"
import { checkAssignees } from "./assignee-guard"
import { nextOccurrence } from "@/lib/recurrence"
import { CreateObligationInput } from "../validations/obligation.schema"
import { supabase } from "@/lib/storage"
import { earliestDeadline } from "@/lib/deadline"

/** The codes this service's routes already map. */
const CREATE_CODES = {
    NOT_FOUND: "ASSIGNEE_NOT_FOUND",
    CROSS_COMPANY: "CROSS_COMPANY_ASSIGNMENT_FORBIDDEN",
    ADMIN_TARGET: "TEAM_LEADER_CANNOT_ASSIGN_TO_ADMIN",
    OUTSIDE_TEAM: "TEAM_LEADER_CANNOT_ASSIGN_OUTSIDE_TEAM",
} as const

const REASSIGN_CODES = {
    NOT_FOUND: "ASSIGNEE_NOT_FOUND",
    CROSS_COMPANY: "CROSS_COMPANY_ASSIGNMENT_FORBIDDEN",
    ADMIN_TARGET: "TL_CANNOT_REASSIGN_TO_ADMIN",
    OUTSIDE_TEAM: "TL_CANNOT_REASSIGN_OUTSIDE_TEAM",
} as const

export class ObligationService {
    static async create(input: CreateObligationInput, session: any) {
        const userRole = session.user.role
        const creatorCompanyId = (session.user as any).companyId
        const { title, description, assigneeIds, deadline, recurrence, difficulty, attachments } = input

        if (!can(session.user, "obligations.manage")) throw new Error("EMPLOYEES_CANNOT_CREATE_OBLIGATIONS")

        // 1. Assignee & Company Validation
        if (userRole !== 'SUPER_ADMIN') {
            if (!creatorCompanyId) throw new Error("USER_NO_COMPANY")

            const verdict = await checkAssignees(assigneeIds, session)
            if (!verdict.ok) throw new Error(CREATE_CODES[verdict.reason])
        }

        // 2. Deadline Safety Check (3-hour buffer)
        const deadlineDate = new Date(deadline)
        const minDeadline = earliestDeadline()
        if (deadlineDate < minDeadline) throw new Error("DEADLINE_TOO_SOON")

        // 3. Attachment Count Limit
        if (attachments && Array.isArray(attachments) && attachments.length > 20) {
            throw new Error("ATTACHMENT_LIMIT_EXCEEDED")
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
                deadline: deadlineDate,
                recurrence: recurrence || 'ONE_TIME',
                difficulty: difficulty || 0,
                attachments: attachments ? JSON.stringify(attachments) : null,
                status: 'PENDING',
                // Obligation.createdById's FK targets User only — a Super
                // Admin's id lives in a separate table. Same guard
                // Task.create()/Vendor.create() use for the identical reason.
                createdById: userRole === 'SUPER_ADMIN' ? null : session.user.id
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

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                if (current.companyId !== (session.user as any).companyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

            // 1. Authorization
            const isManager = can(session.user, "obligations.manage")
            const isAssignee = current.assignees.some((a: any) => a.id === userId)
            if (!isManager && !isAssignee) throw new Error("ACCESS_DENIED")

            // 2. Approving and rejecting are a manager's decision. An assignee
            // may move their own obligation along — in progress, completed —
            // but deciding whether it was done is not theirs: this used to let
            // an Employee approve their own.
            if (status && ['APPROVED', 'REJECTED'].includes(status) && !isManager) {
                throw new Error("ONLY_MANAGERS_DECIDE")
            }

            // 3. Self-approval restriction
            if (status && ['APPROVED', 'REJECTED'].includes(status) && ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && isAssignee) {
                throw new Error("SELF_APPROVAL_FORBIDDEN")
            }

            // 4. Attachment logic
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
                // Removing other people's attachments is for those who manage
                // obligations company-wide; anyone else only their own.
                if (removedItems.length > 0 && !canCompanyWide(session.user, "obligations.manage")) {
                    if (removedItems.some(i => i.uploadedById !== userId)) throw new Error("UNAUTHORIZED_ATTACHMENT_REMOVAL")
                }
                finalAttachments = input.attachments
            }
            if (newAttachments && Array.isArray(newAttachments)) {
                if (finalAttachments.length + newAttachments.length > 20) {
                    throw new Error("ATTACHMENT_LIMIT_EXCEEDED")
                }
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
                // Reassignment is the same decision as assignment, so it is
                // the same rule — handing work to another team, or another
                // company, is not made safe by the obligation already
                // existing. Validated inside the transaction it writes to.
                const verdict = await checkAssignees(assigneeIds, session, tx as any)
                if (!verdict.ok) throw new Error(REASSIGN_CODES[verdict.reason])
                updateData.assignees = { set: assigneeIds.map((uid: string) => ({ id: uid })) }
            }

            const updated = await tx.obligation.update({
                where: { id },
                data: updateData,
                // select, not `assignees: true` — the latter pulls every User
                // column, password hash and mfaSecret included, straight into
                // this function's return value, which the API route sends to
                // the client as-is. Only `.id` is ever read from this (the
                // point-delta loop and the notification list below).
                include: { assignees: { select: { id: true } } }
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

            // 6. Notifications (Centralized)
            if (['APPROVED', 'REJECTED'].includes(status)) {
                const { NotificationService } = await import("./notification.service")
                await NotificationService.notifyMany(
                    updated.assignees.map((a: any) => a.id),
                    status === 'APPROVED' ? 'OBLIGATION_APPROVED' : 'OBLIGATION_REJECTED',
                    `Your obligation "${updated.title}" has been ${status === 'APPROVED' ? 'approved' : 'rejected'}.`,
                    id,
                    tx
                )
            }

            // 7. Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('UPDATE_OBLIGATION', 'OBLIGATION', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: input
            })

            return updated
        })
    }

    static async delete(id: string, session: any) {
        const userId = session.user.id
        const userRole = session.user.role

        if (!can(session.user, "obligations.manage")) throw new Error("ACCESS_DENIED")

        return await prisma.$transaction(async (tx) => {
            const obligation = await tx.obligation.findUnique({
                where: { id },
                select: { status: true, difficulty: true, assignees: { select: { id: true } }, attachments: true, companyId: true, title: true }
            })

            if (!obligation) throw new Error("OBLIGATION_NOT_FOUND")

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                if (obligation.companyId !== (session.user as any).companyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

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

            // Storage Cleanup
            if (obligation.attachments) {
                try {
                    const attachments = JSON.parse(obligation.attachments)
                    if (Array.isArray(attachments)) {
                        const filePaths = attachments
                            .map((a: any) => a.url?.split('/app-assets/')?.[1])
                            .filter(path => !!path)
                        if (filePaths.length > 0) {
                            await supabase.storage.from('app-assets').remove(filePaths)
                        }
                    }
                } catch (e) {
                    console.error("Failed to cleanup obligation attachments:", e)
                }
            }

            await tx.obligation.delete({ where: { id } })

            // 5. Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('DELETE_OBLIGATION', 'OBLIGATION', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: { status: obligation.status, title: (obligation as any).title }
            })

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

            // Security: Company Isolation
            if (session.user.role !== 'SUPER_ADMIN') {
                if (obligation.companyId !== (session.user as any).companyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }
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

            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('REVERT_OBLIGATION', 'OBLIGATION', obligation.id, {
                tx,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? userId : null,
                userId: session.user.role !== 'SUPER_ADMIN' ? userId : null,
                details: {
                    oldStatus: obligation.status,
                    newStatus: 'IN_PROGRESS',
                    pointsDeducted: pointDeduction
                }
            })

            return updatedObligation
        })
    }
    /**
     * Processes recurrent obligations and creates the next instance if due.
     * This is intended to be called by a cron job.
     */
    static async processRecurrentObligations() {
        const finalizedStatuses = ['COMPLETED', 'APPROVED']

        // 1. Find all finalized obligations that are recurrent
        const recurrentObligations = await prisma.obligation.findMany({
            where: {
                recurrence: { not: 'ONE_TIME' },
                status: { in: finalizedStatuses }
            },
            include: { assignees: { select: { id: true } } }
        })

        // 2. Optimization: Batch check for existing instances.
        //    nextOccurrence clamps months and years instead of overflowing: the
        //    previous `setMonth` turned a 31 January monthly obligation into
        //    3 March, so February never got an instance and every later one
        //    drifted to the 3rd. A recurrence with no next instance yields null
        //    and is dropped rather than silently repeating its own deadline.
        const checkPayloads = recurrentObligations.flatMap(obl => {
            const nextDeadline = nextOccurrence(new Date(obl.deadline), obl.recurrence)
            return nextDeadline ? [{ obl, nextDeadline }] : []
        })

        const existingInstances = await prisma.obligation.findMany({
            where: {
                OR: checkPayloads.map(p => ({
                    title: p.obl.title,
                    companyId: p.obl.companyId,
                    deadline: p.nextDeadline
                }))
            },
            select: { title: true, companyId: true, deadline: true }
        })

        const creationResults = []

        for (const { obl, nextDeadline } of checkPayloads) {
            const exists = existingInstances.some(inst =>
                inst.title === obl.title &&
                inst.companyId === obl.companyId &&
                inst.deadline.getTime() === nextDeadline.getTime()
            )

            if (!exists) {
                const newObl = await prisma.obligation.create({
                    data: {
                        title: obl.title,
                        description: obl.description,
                        companyId: obl.companyId,
                        deadline: nextDeadline,
                        recurrence: obl.recurrence,
                        difficulty: obl.difficulty,
                        status: 'PENDING',
                        attachments: null,
                        assignees: {
                            connect: obl.assignees.map(a => ({ id: a.id }))
                        }
                    }
                })

                // Create notifications
                const { NotificationService } = await import("./notification.service")
                await NotificationService.notifyMany(
                    obl.assignees.map(a => a.id),
                    'OBLIGATION_ASSIGNED',
                    `New recurrent instance of "${obl.title}" has been created.`,
                    newObl.id
                )

                creationResults.push({ originalId: obl.id, nextId: newObl.id })
            }
        }

        return creationResults
    }
}
