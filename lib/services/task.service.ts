import { prisma } from "@/lib/prisma"
import { CreateTaskInput, UpdateTaskInput } from "../validations/task.schema"
import { extractCoords, calculateDistance } from "@/lib/location"
import { supabase } from "@/lib/storage"

/**
 * TaskService
 * 
 * Handles business logic for Tasks, decoupling it from the API routes.
 */
export class TaskService {
    /**
     * Creates a new task with assignment and company validation.
     */
    static async create(input: CreateTaskInput, session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = session.user.companyId

        const { assigneeIds, deadline, ...rest } = input
        const deadlineDate = new Date(deadline)

        // 1. Cross-Company Assignment Validation
        if (userRole !== 'SUPER_ADMIN') {
            if (!userCompanyId) throw new Error("USER_NO_COMPANY")

            const assigneeUsers = await prisma.user.findMany({
                where: { id: { in: assigneeIds } },
                select: { id: true, companyId: true, role: true }
            })

            if (assigneeUsers.length !== assigneeIds.length) {
                throw new Error("ASSIGNEE_NOT_FOUND")
            }

            // Check if all assignees belong to the same company
            const externalAssignee = assigneeUsers.find(u => u.companyId !== userCompanyId)
            if (externalAssignee) throw new Error("CROSS_COMPANY_ASSIGNMENT_FORBIDDEN")

            // Team Leader restriction
            if (userRole === 'TEAM_LEADER') {
                const adminAssignee = assigneeUsers.find(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))
                if (adminAssignee) throw new Error("TL_CANNOT_ASSIGN_TO_ADMIN")
            }
        }

        // 2. Deadline Safety Check
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        if (deadlineDate < today) throw new Error("DEADLINE_IN_PAST")

        // 3. Determine target Company ID
        let targetCompanyId = userCompanyId
        if (userRole === 'SUPER_ADMIN') {
            const firstAssignee = await prisma.user.findUnique({
                where: { id: assigneeIds[0] },
                select: { companyId: true }
            })
            targetCompanyId = firstAssignee?.companyId || null
        }

        // 3. Database Transaction
        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.create({
                data: {
                    ...rest,
                    companyId: targetCompanyId,
                    assignees: { connect: assigneeIds.map(id => ({ id })) },
                    deadline: deadlineDate,
                    status: 'PENDING',
                    attachments: input.attachments ? (typeof input.attachments === 'string' ? input.attachments : JSON.stringify(input.attachments)) : null,
                    createdBy: userRole === 'SUPER_ADMIN' ? null : userId,
                    comments: userRole === 'SUPER_ADMIN' ? JSON.stringify([{
                        text: "Task created by Super Admin",
                        author: "System",
                        date: new Date().toISOString()
                    }]) : undefined
                }
            })

            // Create notifications
            await tx.notification.createMany({
                data: assigneeIds.map(id => ({
                    userId: id,
                    type: 'TASK_ASSIGNED',
                    message: `You have been assigned a new task: ${input.title}`,
                    relatedId: task.id
                }))
            })

            return task
        })
    }
    /**
     * Updates task details with change tracking and coordinate verification.
     */
    static async updateDetails(id: string, input: UpdateTaskInput, session: any) {
        const { title, description, assigneeIds, deadline, difficulty, location, attachments } = input
        const userRole = session.user.role
        const userName = session.user.name

        const existingTask = await prisma.task.findUnique({
            where: { id },
            select: { title: true, description: true, location: true, attachments: true, comments: true }
        })

        if (!existingTask) throw new Error("TASK_NOT_FOUND")

        const changes: any = {}
        if (title && existingTask.title !== title) changes.title = { from: existingTask.title, to: title }
        if (description && existingTask.description !== description) changes.description = { from: existingTask.description, to: description }
        if (location && existingTask.location !== location) changes.location = { from: existingTask.location, to: location }

        const existingComments = existingTask.comments ? JSON.parse(existingTask.comments) : []
        let finalComments = [...existingComments, {
            text: "Task details updated",
            type: "TASK_EDITED",
            author: `${userRole} ${userName}`,
            changes: changes,
            date: new Date().toISOString()
        }]

        // Coordinate re-verification if location changed
        if (location) {
            const targetCoords = extractCoords(location)
            if (targetCoords) {
                finalComments = finalComments.map((c: any) => {
                    if (c.type === 'LOCATION_ADDED' && c.location && (!c.verificationStatus || c.autoVerified)) {
                        const submittedCoords = extractCoords(c.location)
                        if (submittedCoords) {
                            const distance = calculateDistance(targetCoords, submittedCoords)
                            c.verificationStatus = distance <= 100 ? 'CORRECT' : 'WRONG'
                            c.autoVerified = true
                        }
                    }
                    return c
                })
            }
        }

        const updateData: any = {
            ...(title && { title }),
            ...(description && { description }),
            ...(deadline && { deadline: new Date(deadline) }),
            ...(difficulty !== undefined && { difficulty }),
            ...(location !== undefined && { location }),
            ...(attachments && { attachments: typeof attachments === 'string' ? attachments : JSON.stringify(attachments) }),
            isEdited: true,
            comments: JSON.stringify(finalComments)
        }

        if (assigneeIds) {
            updateData.assignees = { set: assigneeIds.map((uid: string) => ({ id: uid })) }
        }

        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.update({
                where: { id },
                data: updateData
            })

            if (assigneeIds) {
                await tx.notification.createMany({
                    data: assigneeIds.map((uid: string) => ({
                        userId: uid,
                        type: 'TASK_UPDATED',
                        message: `Task "${title || existingTask.title}" updated by ${userRole} ${userName}.`,
                        relatedId: id
                    }))
                })
            }
            return task
        })
    }

    /**
     * Submits task progress or final submission.
     */
    static async submit(id: string, userId: string, session: any, data: any) {
        const { newAttachments, note, isDraft, location, locationName } = data
        const inputCosts = data.costs || data.costEntries
        const costValue = data.cost ? Number(data.cost) : 0

        return await prisma.$transaction(async (tx) => {
            const currentTask = await tx.task.findUnique({
                where: { id },
                include: { assignees: true }
            })
            if (!currentTask) throw new Error("TASK_NOT_FOUND")

            // Handle Attachments
            let finalAttachments: any[] = []
            if (currentTask.attachments) {
                try {
                    const parsed = JSON.parse(currentTask.attachments)
                    finalAttachments = Array.isArray(parsed) ? parsed : (parsed?.url ? [parsed] : [])
                } catch { finalAttachments = [] }
            }

            if (newAttachments && Array.isArray(newAttachments)) {
                const formattedNew = newAttachments.map(att => typeof att === 'string' ? {
                    url: att,
                    name: att.split('/').pop() || 'Attachment',
                    uploadedBy: session.user.name || 'Unknown',
                    uploadedById: userId,
                    uploadedAt: new Date().toISOString()
                } : att)
                finalAttachments = [...finalAttachments, ...formattedNew]
            }

            // Handle Comments (Notes, Costs, Location)
            const comments = currentTask.comments ? JSON.parse(currentTask.comments) : []
            if (note) comments.push({ text: note, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'SUBMISSION_NOTE' })

            let totalAdded = costValue
            if (costValue > 0) {
                comments.push({ text: `Added cost: ${costValue.toFixed(2)} EGP`, amount: costValue, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'COST_ADDITION' })
            }

            if (inputCosts && Array.isArray(inputCosts)) {
                for (const c of inputCosts) {
                    const cVal = Number(c.amount)
                    if (cVal > 0) {
                        comments.push({ text: `Added cost: ${cVal.toFixed(2)} EGP`, amount: cVal, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'COST_ADDITION' })
                        totalAdded += cVal
                    }
                }
            }

            if (location) {
                const userLocs = comments.filter((c: any) => c.type === 'LOCATION_ADDED' && c.authorId === userId)
                if (userLocs.length >= 10) throw new Error("USER_LOCATION_LIMIT")

                const locationComment: any = { text: locationName ? `Location: ${locationName}` : `Location: ${location}`, location, locationName, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'LOCATION_ADDED' }

                if (currentTask.location) {
                    const targetCoords = extractCoords(currentTask.location)
                    const submittedCoords = extractCoords(location)
                    if (targetCoords && submittedCoords) {
                        const distance = calculateDistance(targetCoords, submittedCoords)
                        locationComment.verificationStatus = distance <= 100 ? 'CORRECT' : 'WRONG'
                        locationComment.autoVerified = true
                    }
                }
                comments.push(locationComment)
            }

            // Update data
            const updateData: any = {
                status: isDraft ? 'IN_PROGRESS' : 'PENDING_CONFIRMATION',
                attachments: JSON.stringify(finalAttachments),
                comments: JSON.stringify(comments)
            }

            if (totalAdded > 0) {
                const memberCosts = currentTask.memberCosts ? JSON.parse(currentTask.memberCosts as string) : {}
                const memberPaymentStatus = currentTask.memberPaymentStatus ? JSON.parse(currentTask.memberPaymentStatus as string) : {}

                memberCosts[userId] = (memberCosts[userId] || 0) + totalAdded
                memberPaymentStatus[userId] = 'PENDING_PAYMENT'

                updateData.memberCosts = JSON.stringify(memberCosts)
                updateData.memberPaymentStatus = JSON.stringify(memberPaymentStatus)
                updateData.totalCost = { increment: totalAdded }
            }

            const task = await tx.task.update({ where: { id }, data: updateData })

            if (!isDraft && task.createdBy) {
                await tx.notification.create({
                    data: { userId: task.createdBy, type: 'TASK_SUBMITTED', message: `Task "${task.title}" has been submitted by ${session.user.name}`, relatedId: id }
                })
            }

            return task
        })
    }

    /**
     * Reviews a task submission.
     */
    static async review(id: string, session: any, data: any) {
        const { status: statusProp, action, difficulty } = data
        const status = statusProp || action
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.$transaction(async (tx) => {
            const oldTask = await tx.task.findUnique({
                where: { id },
                select: { status: true, difficulty: true, totalCost: true, title: true, assignees: { select: { id: true } } }
            })
            if (!oldTask) throw new Error("TASK_NOT_FOUND")

            if (['ADMIN', 'SUPER_ADMIN'].includes(userRole) && oldTask.assignees.some(a => a.id === userId)) {
                throw new Error("SELF_REVIEW_FORBIDDEN")
            }

            let newStatus = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(status) ? status : 'REJECTED'
            if (newStatus === 'APPROVED' && oldTask.totalCost === 0) newStatus = 'COMPLETED'

            const newDifficulty = (typeof difficulty === 'number') ? difficulty : oldTask.difficulty
            const hasPoints = (s: string) => ['APPROVED', 'COMPLETED'].includes(s)

            let pointDelta = 0
            if (!hasPoints(oldTask.status) && hasPoints(newStatus)) pointDelta = newDifficulty
            else if (hasPoints(oldTask.status) && !hasPoints(newStatus)) pointDelta = -oldTask.difficulty
            else if (hasPoints(oldTask.status) && hasPoints(newStatus)) pointDelta = newDifficulty - oldTask.difficulty

            const task = await tx.task.update({
                where: { id },
                data: { status: newStatus, difficulty: newDifficulty, lastStatusUpdateBy: `${userRole} ${session.user.name}` },
                include: { assignees: true }
            })

            if (pointDelta !== 0) {
                await tx.user.updateMany({
                    where: { id: { in: oldTask.assignees.map(a => a.id) } },
                    data: { totalDifficultyPoints: { increment: pointDelta } }
                })
            }

            await tx.notification.createMany({
                data: task.assignees.map(a => ({
                    userId: a.id,
                    type: newStatus === 'APPROVED' ? 'TASK_APPROVED' : newStatus === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_REJECTED',
                    message: `Your task "${task.title}" has been ${newStatus.toLowerCase()}`,
                    relatedId: id
                }))
            })

            return task
        })
    }

    /**
     * Applies a manual penalty.
     */
    static async applyPenalty(id: string, targetUserId: string, amount: number, session: any) {
        const userRole = session.user.role
        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const currentYear = now.getFullYear()

        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({ where: { id } })
            if (!task) throw new Error("TASK_NOT_FOUND")

            const salaryRecord = await tx.salaryRecord.findUnique({
                where: { userId_month_year: { userId: targetUserId, month: currentMonth, year: currentYear } }
            })

            if (salaryRecord) {
                await tx.salaryRecord.update({
                    where: { id: salaryRecord.id },
                    data: { deductions: { increment: amount } }
                })
            } else {
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
                const targetUser = await tx.user.findUnique({ where: { id: targetUserId } })
                await tx.salaryRecord.create({
                    data: {
                        userId: targetUserId,
                        month: currentMonth,
                        year: currentYear,
                        totalDays: daysInMonth,
                        deductions: amount,
                        baseSalary: targetUser?.salary || 0
                    }
                })
            }

            await tx.salaryAdjustment.create({
                data: {
                    userId: targetUserId,
                    type: 'DEDUCTION',
                    amount: amount,
                    reason: "Lateness Penalty Deduction",
                    status: 'ACTIVE'
                }
            })

            const comments = task.comments ? JSON.parse(task.comments) : []
            comments.push({
                text: `Lateness Penalty Deduction applied with ${amount} days`,
                author: "System",
                date: now.toISOString(),
                type: 'SYSTEM_DEDUCTION',
                amount: amount
            })

            await tx.task.update({
                where: { id },
                data: { comments: JSON.stringify(comments) }
            })

            return { id }
        })
    }

    /**
     * Transfers a task.
     */
    static async transfer(id: string, session: any, data: any) {
        const { newAssigneeIds } = data
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.$transaction(async (tx) => {
            // 1. Fetch original task with assignees
            const originalTask = await (tx.task as any).findUnique({
                where: { id },
                include: { assignees: true }
            })

            if (!originalTask) throw new Error("TASK_NOT_FOUND")

            // Permission check
            const currentAssigneeIds = (originalTask as any).assignees.map((a: any) => a.id)
            const isAssignee = currentAssigneeIds.includes(userId)
            if (!isAssignee && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
                throw new Error("UNAUTHORIZED_TRANSFER")
            }

            // Identify changes
            const keptIds = newAssigneeIds.filter((id: string) => currentAssigneeIds.includes(id))
            const addedIds = newAssigneeIds.filter((id: string) => !currentAssigneeIds.includes(id))
            const removedIds = currentAssigneeIds.filter((id: string) => !newAssigneeIds.includes(id))

            // TEAM_LEADER Restriction check for ADDED users
            if (userRole === 'TEAM_LEADER' && addedIds.length > 0) {
                const targetUsers = await tx.user.findMany({
                    where: { id: { in: addedIds } },
                    select: { role: true }
                })
                if (targetUsers.some(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))) {
                    throw new Error("TL_RESTRICTION")
                }
            }

            // 2. Prepare original task update
            let existingComments: any[] = []
            try {
                existingComments = originalTask.comments ? JSON.parse(originalTask.comments) : []
                if (!Array.isArray(existingComments)) existingComments = []
            } catch { existingComments = [] }

            const transferComment = {
                text: `Task transfer processed. (Assigned to ${addedIds.length} new users).`,
                author: "System",
                date: new Date().toISOString(),
                type: 'TASK_TRANSFERRED'
            }

            await (tx.task as any).update({
                where: { id },
                data: {
                    status: 'PENDING_CONFIRMATION',
                    assignees: {
                        set: keptIds.map((id: string) => ({ id }))
                    },
                    comments: JSON.stringify([...existingComments, transferComment]),
                    lastStatusUpdateBy: `${userRole} ${session.user.name}`
                }
            })

            // 3. Create Copy for ADDED assignees
            let commentsToClone: any[] = []
            try {
                if (originalTask.comments) {
                    const parsed = JSON.parse(originalTask.comments)
                    if (Array.isArray(parsed)) {
                        commentsToClone = parsed.filter((c: any) => c.type !== 'COST_ADDITION' && c.type !== 'LOCATION_ADDED' && c.type !== 'TASK_TRANSFERRED')
                    }
                }
            } catch { commentsToClone = [] }

            let newTask: any = null
            if (addedIds.length > 0) {
                newTask = await (tx.task as any).create({
                    data: {
                        title: originalTask.title + " (Transfer Copy)",
                        description: originalTask.description,
                        companyId: originalTask.companyId,
                        assignees: { connect: addedIds.map((id: string) => ({ id })) },
                        deadline: originalTask.deadline,
                        difficulty: originalTask.difficulty,
                        status: 'PENDING',
                        createdBy: originalTask.createdBy,
                        attachments: originalTask.attachments,
                        location: originalTask.location,
                        comments: JSON.stringify([...commentsToClone, {
                            text: `Transferred from task "${originalTask.title}".`,
                            author: "System",
                            date: new Date().toISOString(),
                            type: 'TASK_CREATED'
                        }])
                    }
                })

                // Create notifications for all new assignees
                await tx.notification.createMany({
                    data: addedIds.map((id: string) => ({
                        userId: id,
                        type: 'TASK_ASSIGNED',
                        message: `You have been assigned a transferred task: ${newTask.title}`,
                        relatedId: newTask.id
                    }))
                })
            }

            // 4. Audit
            await tx.auditLog.create({
                data: {
                    action: 'TRANSFER_TASK',
                    entityType: 'TASK',
                    entityId: originalTask.id,
                    userId: userRole === 'SUPER_ADMIN' ? null : userId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: JSON.stringify({
                        addedCount: addedIds.length,
                        removedCount: removedIds.length,
                        keptCount: keptIds.length,
                        newAssigneeIds: addedIds.map((id: string) => id)
                    })
                }
            })

            return { originalId: originalTask.id, clones: newTask ? 1 : 0 }
        })
    }

    /**
     * Acknowledges a task edit.
     */
    static async acknowledge(id: string) {
        return await prisma.task.update({
            where: { id },
            data: { isEdited: false }
        })
    }

    /**
     * Deletes a task.
     */
    static async delete(id: string, userId: string, userRole: string) {
        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id },
                select: { status: true, difficulty: true, assignees: { select: { id: true } }, attachments: true }
            })
            if (!task) throw new Error("TASK_NOT_FOUND")

            const isSelfAssigned = task.assignees.some((a: any) => a.id === userId)
            if (['ADMIN', 'SUPER_ADMIN'].includes(userRole) && isSelfAssigned) {
                throw new Error("SELF_DELETION_FORBIDDEN")
            }

            if (['APPROVED', 'COMPLETED'].includes(task.status)) {
                for (const a of task.assignees) {
                    await tx.user.update({
                        where: { id: a.id },
                        data: { totalDifficultyPoints: { decrement: task.difficulty } }
                    })
                }
            }

            if (task.attachments) {
                try {
                    const attachments = JSON.parse(task.attachments)
                    if (Array.isArray(attachments)) {
                        const filePaths = attachments
                            .map((a: any) => a.url?.split('/app-assets/')?.[1])
                            .filter(path => !!path)
                        if (filePaths.length > 0) {
                            await supabase.storage.from('app-assets').remove(filePaths)
                        }
                    }
                } catch (e) {
                    console.error("Task attachment cleanup failed:", e)
                }
            }

            await tx.task.delete({ where: { id } })
            return { success: true, id }
        })
    }
    /**
     * Reverts a task to IN_PROGRESS.
     */
    static async revert(id: string, session: any) {
        const userId = session.user.id
        const userName = session.user.name

        return await prisma.$transaction(async (tx) => {
            const task = await (tx.task as any).findUnique({
                where: { id },
                include: { assignees: { select: { id: true } } }
            }) as any

            if (!task) throw new Error("TASK_NOT_FOUND")
            if (!['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(task.status)) {
                throw new Error(`CANNOT_REVERT_STATUS_${task.status}`)
            }
            if (task.paymentStatus !== 'PENDING_PAYMENT') throw new Error("TASK_ALREADY_PAID")

            const pointDeduction = ['APPROVED', 'COMPLETED'].includes(task.status) ? task.difficulty : 0

            const updatedTask = await tx.task.update({
                where: { id },
                data: { status: 'IN_PROGRESS', lastStatusUpdateBy: `SUPER_ADMIN ${userName}` }
            })

            if (pointDeduction > 0) {
                const assigneeIds = task.assignees.map((a: any) => a.id)
                await tx.user.updateMany({
                    where: { id: { in: assigneeIds } },
                    data: { totalDifficultyPoints: { decrement: pointDeduction } }
                })
            }

            await tx.notification.createMany({
                data: task.assignees.map((a: any) => ({
                    userId: a.id,
                    type: 'TASK_REVERTED',
                    message: `Super Admin has reverted task "${task.title}" back to In Progress.`,
                    relatedId: task.id
                }))
            })

            const isSuperAdminEntity = await tx.superAdmin.findUnique({ where: { id: userId } })
            await tx.auditLog.create({
                data: {
                    action: 'REVERT_TASK',
                    entityType: 'TASK',
                    entityId: task.id,
                    superAdminId: isSuperAdminEntity ? userId : null,
                    userId: isSuperAdminEntity ? null : userId,
                    details: JSON.stringify({ oldStatus: task.status, newStatus: 'IN_PROGRESS', pointsDeducted: pointDeduction })
                }
            })

            return updatedTask
        })
    }

    /**
     * Updates task payment status.
     */
    static async updatePayment(id: string, session: any, data: any) {
        const { paymentStatus, targetUserId } = data
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.$transaction(async (tx) => {
            const currentTask = await tx.task.findUnique({
                where: { id },
                include: { assignees: true }
            })
            if (!currentTask) throw new Error("TASK_NOT_FOUND")

            const updateData: any = {}
            const memberPayments = currentTask.memberPaymentStatus ? (typeof currentTask.memberPaymentStatus === 'string' ? JSON.parse(currentTask.memberPaymentStatus) : currentTask.memberPaymentStatus) : {}

            if (targetUserId) {
                memberPayments[targetUserId] = paymentStatus
                updateData.memberPaymentStatus = JSON.stringify(memberPayments)
                const allPaid = Object.values(memberPayments).every(s => s === 'PAID')
                if (allPaid) {
                    updateData.paymentStatus = 'PAID'
                    updateData.status = 'COMPLETED'
                } else {
                    updateData.paymentStatus = 'PENDING_PAYMENT'
                    updateData.status = 'APPROVED'
                }
            } else {
                updateData.paymentStatus = paymentStatus
                if (paymentStatus === 'PAID') {
                    updateData.status = 'COMPLETED'
                    const newPayments: any = {}
                    currentTask.assignees.forEach(a => newPayments[a.id] = 'PAID')
                    updateData.memberPaymentStatus = JSON.stringify(newPayments)
                } else {
                    updateData.status = 'APPROVED'
                    const newPayments: any = {}
                    currentTask.assignees.forEach(a => newPayments[a.id] = 'PENDING_PAYMENT')
                    updateData.memberPaymentStatus = JSON.stringify(newPayments)
                }
            }

            const task = await tx.task.update({ where: { id }, data: updateData })

            await tx.auditLog.create({
                data: {
                    action: 'UPDATE_PAYMENT_STATUS',
                    entityType: 'TASK',
                    entityId: id,
                    userId: userRole === 'SUPER_ADMIN' ? null : userId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: JSON.stringify({ paymentStatus: updateData.paymentStatus || task.paymentStatus, targetUserId, taskStatus: updateData.status || task.status })
                }
            })

            return task
        })
    }

    /**
     * Deletes a specific item (attachment, cost, note, location) from a task.
     */
    static async deleteItem(id: string, session: any, data: any) {
        const { type, itemId } = data
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({ where: { id } })
            if (!task) throw new Error("TASK_NOT_FOUND")
            if (task.status !== 'IN_PROGRESS') throw new Error("TASK_NOT_IN_PROGRESS")

            const updateData: any = {}

            if (type === 'ATTACHMENT') {
                const attachments = task.attachments ? JSON.parse(task.attachments) : []
                const att = attachments.find((a: any) => a.url === itemId)
                if (!att) throw new Error("ITEM_NOT_FOUND")

                const isAuthor = att.uploadedById === userId
                const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)
                if (!isAuthor && !isAdmin) throw new Error("UNAUTHORIZED_ITEM_DELETE")

                updateData.attachments = JSON.stringify(attachments.filter((a: any) => a.url !== itemId))
            } else if (type === 'COST_ADDITION' || type === 'SUBMISSION_NOTE' || type === 'LOCATION_ADDED') {
                const comments = task.comments ? JSON.parse(task.comments) : []
                const item = comments.find((c: any) => c.type === type && (c.date === itemId || c.timestamp === itemId))
                if (!item) throw new Error("ITEM_NOT_FOUND")

                const isAuthor = item.authorId === userId
                const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)
                if (!isAuthor && !isAdmin) throw new Error("UNAUTHORIZED_ITEM_DELETE")

                updateData.comments = JSON.stringify(comments.filter((c: any) => !(c.type === type && (c.date === itemId || c.timestamp === itemId))))

                if (type === 'COST_ADDITION' && item.amount) {
                    updateData.totalCost = { decrement: item.amount }
                    const memberCosts = task.memberCosts ? (typeof task.memberCosts === 'string' ? JSON.parse(task.memberCosts) : task.memberCosts) : {}
                    if (item.authorId && memberCosts[item.authorId]) {
                        memberCosts[item.authorId] = Math.max(0, memberCosts[item.authorId] - item.amount)
                        updateData.memberCosts = JSON.stringify(memberCosts)
                    }
                }
            } else {
                throw new Error("INVALID_ITEM_TYPE")
            }

            return await tx.task.update({ where: { id }, data: updateData })
        })
    }

    /**
     * Verifies a location entry.
     */
    static async verifyLocation(id: string, session: any, timestamp: string, status: string) {
        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({ where: { id } })
            if (!task) throw new Error("TASK_NOT_FOUND")

            const comments = task.comments ? JSON.parse(task.comments) : []
            const idx = comments.findIndex((c: any) => c.type === 'LOCATION_ADDED' && c.date === timestamp)
            if (idx === -1) throw new Error("ITEM_NOT_FOUND")

            comments[idx].verificationStatus = status
            return await tx.task.update({ where: { id }, data: { comments: JSON.stringify(comments) } })
        })
    }
    /**
     * Bulk creates tasks.
     */
    static async bulkCreate(tasks: any[], session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = session.user.companyId

        return await prisma.$transaction(async (tx) => {
            const results = []
            const notificationsData: any[] = []

            for (const task of tasks) {
                const { assigneeIds, deadline, ...rest } = task
                const createdTask = await (tx.task as any).create({
                    data: {
                        ...rest,
                        status: "PENDING",
                        deadline: new Date(deadline),
                        createdBy: userRole === 'SUPER_ADMIN' ? null : userId,
                        companyId: userRole === 'SUPER_ADMIN' ? (await tx.user.findUnique({ where: { id: assigneeIds[0] }, select: { companyId: true } }))?.companyId : userCompanyId,
                        assignees: {
                            connect: assigneeIds.map((id: string) => ({ id }))
                        }
                    }
                })
                results.push(createdTask)

                for (const aid of assigneeIds) {
                    notificationsData.push({
                        userId: aid,
                        type: "TASK_ASSIGNED",
                        message: `New task assigned: ${task.title}`,
                        relatedId: createdTask.id
                    })
                }
            }

            if (notificationsData.length > 0) {
                await tx.notification.createMany({ data: notificationsData })
            }

            return results
        }, { timeout: 30000 })
    }

    /**
     * Bulk updates task payment status.
     */
    static async bulkUpdatePayment(taskIds: string[], session: any) {
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.$transaction(async (tx) => {
            const tasks = await tx.task.findMany({
                where: {
                    id: { in: taskIds },
                    paymentStatus: 'PENDING_PAYMENT'
                },
                select: { id: true, memberCosts: true } as any
            })

            for (const task of tasks) {
                const newMemberPaymentStatus: Record<string, string> = {}
                const mCosts = typeof (task as any).memberCosts === 'string'
                    ? JSON.parse((task as any).memberCosts)
                    : ((task as any).memberCosts as any || {})

                Object.keys(mCosts).forEach(uid => {
                    newMemberPaymentStatus[uid] = 'PAID'
                })

                await tx.task.update({
                    where: { id: (task as any).id as string },
                    data: {
                        paymentStatus: 'PAID',
                        status: 'COMPLETED',
                        memberPaymentStatus: JSON.stringify(newMemberPaymentStatus)
                    } as any
                })
            }

            await tx.auditLog.create({
                data: {
                    action: 'BULK_UPDATE_PAYMENT_STATUS',
                    entityType: 'TASK',
                    entityId: 'BULK',
                    userId: userRole === 'SUPER_ADMIN' ? null : userId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: JSON.stringify({ taskIds, count: tasks.length, paymentStatus: 'PAID' })
                }
            })

            return { count: tasks.length }
        })
    }
}
