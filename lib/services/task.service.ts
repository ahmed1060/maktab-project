import { prisma } from "@/lib/prisma"
import { checkAssignees } from "./assignee-guard"
import { CreateTaskInput, UpdateTaskInput } from "../validations/task.schema"
import { extractCoords, extractAccuracy, locationVerdict } from "@/lib/location"
import { supabase } from "@/lib/storage"
import { normalizeJsonInput } from "@/lib/json-input"
import { SystemSettingsService } from "./system-settings.service"
import { earliestDeadline } from "@/lib/deadline"

/**
 * TaskService
 *
 * Handles business logic for Tasks, decoupling it from the API routes.
 */
/** Each caller keeps the refusal codes its route already promises. */
const CREATE_CODES = {
    NOT_FOUND: "ASSIGNEE_NOT_FOUND",
    CROSS_COMPANY: "CROSS_COMPANY_ASSIGNMENT_FORBIDDEN",
    ADMIN_TARGET: "TL_CANNOT_ASSIGN_TO_ADMIN",
    OUTSIDE_TEAM: "TL_CANNOT_ASSIGN_OUTSIDE_TEAM",
} as const

export class TaskService {
    /**
     * Creates a new task with assignment and company validation.
     */
    static async create(input: CreateTaskInput, session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = session.user.companyId

        const { assigneeIds, deadline, vendorId, location: requestedLocation, ...rest } = input
        const deadlineDate = new Date(deadline)

        // 1. Cross-Company Assignment Validation
        if (userRole !== 'SUPER_ADMIN') {
            if (!userCompanyId) throw new Error("USER_NO_COMPANY")

            const verdict = await checkAssignees(assigneeIds, session)
            if (!verdict.ok) throw new Error(CREATE_CODES[verdict.reason])
        }

        // 1.5 Vendor resolution — authoritative when present: the location
        // actually stored comes from the vendor, not from whatever location
        // text the request also carried (see createTaskSchema's vendorId
        // comment for why: a UI toggle alone isn't a real guarantee against
        // a tampered request sending both).
        let resolvedVendorId: string | null = null
        let resolvedLocation = requestedLocation
        if (vendorId) {
            const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } })
            if (!vendor) throw new Error("VENDOR_NOT_FOUND")
            if (userRole !== 'SUPER_ADMIN' && vendor.companyId !== userCompanyId) {
                throw new Error("CROSS_COMPANY_VENDOR_FORBIDDEN")
            }
            resolvedVendorId = vendor.id
            resolvedLocation = JSON.stringify({ name: vendor.locationName, link: vendor.locationLink || '' })
        }

        // 2. Deadline Safety Check (Strengthened to 3-hour minimum)
        const minDeadline = earliestDeadline()
        if (deadlineDate < minDeadline) throw new Error("DEADLINE_TOO_SOON")

        // 3. Attachment Count Limit
        if (input.attachments && Array.isArray(input.attachments) && input.attachments.length > 20) {
            throw new Error("ATTACHMENT_LIMIT_EXCEEDED")
        }

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
                    location: resolvedLocation,
                    vendorId: resolvedVendorId,
                    companyId: targetCompanyId,
                    assignees: { connect: assigneeIds.map(id => ({ id })) },
                    deadline: deadlineDate,
                    status: 'PENDING',
                    ...(input.attachments ? { attachments: normalizeJsonInput(input.attachments) } : {}),
                    createdBy: userRole === 'SUPER_ADMIN' ? null : userId,
                    ...(userRole === 'SUPER_ADMIN' ? {
                        comments: [{
                            text: "Task created by Super Admin",
                            author: "System",
                            date: new Date().toISOString()
                        }]
                    } : {})
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
            select: {
                title: true, description: true, location: true, attachments: true, comments: true, companyId: true,
                company: { select: { autoVerifyLocation: true } }
            }
        })

        if (!existingTask) throw new Error("TASK_NOT_FOUND")

        // Security: Company Isolation
        if (userRole !== 'SUPER_ADMIN') {
            const userCompanyId = (session.user as any).companyId
            if (existingTask.companyId !== userCompanyId) {
                throw new Error("ACCESS_DENIED")
            }
        }

        const changes: any = {}
        if (title && existingTask.title !== title) changes.title = { from: existingTask.title, to: title }
        if (description && existingTask.description !== description) changes.description = { from: existingTask.description, to: description }
        if (location && existingTask.location !== location) changes.location = { from: existingTask.location, to: location }

        const existingComments: any[] = Array.isArray(existingTask.comments) ? existingTask.comments : []
        let finalComments = [...existingComments, {
            text: "Task details updated",
            type: "TASK_EDITED",
            author: `${userRole} ${userName}`,
            changes: changes,
            date: new Date().toISOString()
        }]

        // Coordinate re-verification if location changed — Company Settings'
        // autoVerifyLocation gates whether this runs at all; a task with no
        // company (only possible for a SUPER_ADMIN-created task) defaults to
        // on, same as a fresh Company row would.
        const autoVerifyLocation = existingTask.company?.autoVerifyLocation ?? true
        if (location && autoVerifyLocation) {
            const targetCoords = extractCoords(location)
            if (targetCoords) {
                const { locationVerifyRadiusMeters } = await SystemSettingsService.get()
                finalComments = finalComments.map((c: any) => {
                    if (c.type === 'LOCATION_ADDED' && c.location && (!c.verificationStatus || c.autoVerified)) {
                        const submittedCoords = extractCoords(c.location)
                        if (!submittedCoords) return c

                        const accuracy = extractAccuracy(c.location)

                        // A reading taken before accuracy was recorded keeps
                        // whatever verdict it already has. It was decided under
                        // the old point-to-point rule and may already have
                        // justified a penalty; re-opening it would turn every
                        // historical verdict into review work and put nothing
                        // in the queue a person could actually resolve.
                        if (accuracy === null && c.verificationStatus) return c

                        c.verificationStatus = locationVerdict(
                            targetCoords, submittedCoords, locationVerifyRadiusMeters, accuracy,
                        )
                        c.autoVerified = true
                    }
                    return c
                })
            }
        }

        const updateData: any = {
            ...(title && { title }),
            ...(description && { description }),
            ...(difficulty !== undefined && { difficulty }),
            ...(location !== undefined && { location }),
            ...(attachments && { attachments: normalizeJsonInput(attachments) }),
            isEdited: true,
            comments: finalComments
        }

        if (deadline) {
            const deadlineDate = new Date(deadline as string)
            const minDeadline = earliestDeadline()
            if (deadlineDate < minDeadline) throw new Error("DEADLINE_TOO_SOON")
            updateData.deadline = deadlineDate
        }

        if (assigneeIds) {
            // This was missing entirely. The task's own company was checked
            // above and then whatever ids the request carried were written, so
            // a task could be handed to another company's user, who would see
            // it in their own list. Same rule as creation, same function.
            const verdict = await checkAssignees(assigneeIds, session)
            if (!verdict.ok) throw new Error(CREATE_CODES[verdict.reason])
            updateData.assignees = { set: assigneeIds.map((uid: string) => ({ id: uid })) }
        }

        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.update({
                where: { id },
                data: updateData
            })

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('UPDATE_TASK_DETAILS', 'TASK', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null,
                details: { changes, deadline: updateData.deadline, difficulty: updateData.difficulty, assigneeIds }
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
                include: { assignees: true, company: { select: { autoVerifyLocation: true } } }
            })
            if (!currentTask) throw new Error("TASK_NOT_FOUND")

            // Security: Company Isolation
            const userRole = session.user.role
            if (userRole !== 'SUPER_ADMIN') {
                const userCompanyId = (session.user as any).companyId
                if (currentTask.companyId !== userCompanyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

            // Also check if submitting for self unless Admin
            const isAssignee = currentTask.assignees.some((a: any) => a.id === userId)
            if (userRole === 'EMPLOYEE' && !isAssignee) throw new Error("ACCESS_DENIED")

            // Handle Attachments
            let finalAttachments: any[] = []
            if (currentTask.attachments) {
                const parsed = currentTask.attachments as any
                finalAttachments = Array.isArray(parsed) ? parsed : (parsed?.url ? [parsed] : [])
            }

            if (newAttachments && Array.isArray(newAttachments)) {
                if (finalAttachments.length + newAttachments.length > 20) {
                    throw new Error("ATTACHMENT_LIMIT_EXCEEDED")
                }
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
            const comments: any[] = Array.isArray(currentTask.comments) ? currentTask.comments : []
            if (note) comments.push({ text: note, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'SUBMISSION_NOTE' })

            let totalAdded = costValue
            if (inputCosts && Array.isArray(inputCosts)) {
                for (const c of inputCosts) {
                    const cVal = Number(c.amount)
                    if (cVal > 0) {
                        totalAdded += cVal
                    }
                }
            }

            if (totalAdded > 10000) throw new Error("COST_LIMIT_EXCEEDED")

            if (costValue > 0) {
                comments.push({ text: `Added cost: ${costValue.toFixed(2)} EGP`, amount: costValue, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'COST_ADDITION' })
            }

            if (inputCosts && Array.isArray(inputCosts)) {
                for (const c of inputCosts) {
                    const cVal = Number(c.amount)
                    if (cVal > 0) {
                        comments.push({ text: `Added cost: ${cVal.toFixed(2)} EGP`, amount: cVal, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'COST_ADDITION' })
                    }
                }
            }

            if (location) {
                const userLocs = comments.filter((c: any) => c.type === 'LOCATION_ADDED' && c.authorId === userId)
                if (userLocs.length >= 10) throw new Error("USER_LOCATION_LIMIT")

                const locationComment: any = { text: locationName ? `Location: ${locationName}` : `Location: ${location}`, location, locationName, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'LOCATION_ADDED' }

                // Company Settings' autoVerifyLocation gates this entirely — a
                // task with no company (only possible when SUPER_ADMIN-created)
                // defaults to on, same as a fresh Company row would.
                const autoVerifyLocation = currentTask.company?.autoVerifyLocation ?? true
                if (currentTask.location && autoVerifyLocation) {
                    const targetCoords = extractCoords(currentTask.location)
                    const submittedCoords = extractCoords(location)
                    if (targetCoords && submittedCoords) {
                        const { locationVerifyRadiusMeters } = await SystemSettingsService.get()
                        locationComment.verificationStatus = locationVerdict(
                            targetCoords,
                            submittedCoords,
                            locationVerifyRadiusMeters,
                            extractAccuracy(location),
                        )
                        locationComment.autoVerified = true
                    }
                }
                comments.push(locationComment)
            }

            // Update data
            const updateData: any = {
                status: isDraft ? 'IN_PROGRESS' : 'PENDING_CONFIRMATION',
                attachments: finalAttachments,
                comments: comments
            }

            if (totalAdded > 0) {
                const memberCosts: Record<string, number> = (currentTask.memberCosts as any) || {}
                const memberPaymentStatus: Record<string, string> = (currentTask.memberPaymentStatus as any) || {}

                memberCosts[userId] = (memberCosts[userId] || 0) + totalAdded
                memberPaymentStatus[userId] = 'PENDING_PAYMENT'

                updateData.memberCosts = memberCosts
                updateData.memberPaymentStatus = memberPaymentStatus
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
                select: { status: true, difficulty: true, totalCost: true, title: true, companyId: true, assignees: { select: { id: true } } }
            })
            if (!oldTask) throw new Error("TASK_NOT_FOUND")

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                const userCompanyId = (session.user as any).companyId
                if (oldTask.companyId !== userCompanyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

            if (['ADMIN', 'SUPER_ADMIN'].includes(userRole) && oldTask.assignees.some(a => a.id === userId)) {
                throw new Error("SELF_REVIEW_FORBIDDEN")
            }

            let newStatus = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(status) ? status : 'REJECTED'
            if (newStatus === 'APPROVED' && oldTask.totalCost.isZero()) newStatus = 'COMPLETED'

            const newDifficulty = (typeof difficulty === 'number') ? difficulty : oldTask.difficulty
            const hasPoints = (s: string) => ['APPROVED', 'COMPLETED'].includes(s)

            let pointDelta = 0
            if (!hasPoints(oldTask.status) && hasPoints(newStatus)) pointDelta = newDifficulty
            else if (hasPoints(oldTask.status) && !hasPoints(newStatus)) pointDelta = -oldTask.difficulty
            else if (hasPoints(oldTask.status) && hasPoints(newStatus)) pointDelta = newDifficulty - oldTask.difficulty

            const task = await tx.task.update({
                where: { id },
                data: { status: newStatus, difficulty: newDifficulty, lastStatusUpdateBy: `${userRole} ${session.user.name}` },
                // select, not `assignees: true` — the latter pulls every User
                // column, password hash and mfaSecret included, straight into
                // this function's return value, which the API route sends to
                // the client as-is. Only `.length` (line below) and `.id`
                // (the point-delta update above) are ever read from this.
                include: { assignees: { select: { id: true } } }
            })

            if (pointDelta !== 0) {
                await tx.user.updateMany({
                    where: { id: { in: oldTask.assignees.map(a => a.id) } },
                    data: { totalDifficultyPoints: { increment: pointDelta } }
                })
            }

            // 5. Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('REVIEW_TASK', 'TASK', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: {
                    taskTitle: task.title,
                    oldStatus: oldTask.status,
                    newStatus,
                    pointsChange: pointDelta,
                    difficulty: newDifficulty,
                    assigneeCount: task.assignees.length
                }
            })

            // 6. Lateness Flagging
            if (['APPROVED', 'COMPLETED'].includes(newStatus)) {
                const submissionTime = new Date(task.updatedAt)
                const deadlineTime = new Date(task.deadline)

                if (submissionTime > deadlineTime) {
                    const comments: any[] = Array.isArray(task.comments) ? task.comments : []
                    comments.push({
                        text: `Lateness detected: Submitted on ${submissionTime.toLocaleString()} (Deadline: ${deadlineTime.toLocaleString()})`,
                        author: "System",
                        date: new Date().toISOString(),
                        type: 'SYSTEM_FLAG'
                    })

                    await tx.task.update({
                        where: { id },
                        data: { comments }
                    })
                }
            }

            return task
        })
    }

    /**
     * Applies a manual penalty.
     */
    static async applyPenalty(id: string, targetUserId: string, amount: number, session: any) {
        const now = new Date()

        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({ where: { id } })
            if (!task) throw new Error("TASK_NOT_FOUND")

            // Through SalaryService, not a second hand-rolled find-or-create.
            // This block used to compute its own days-in-month and read its own
            // base salary, so there were two definitions of how a SalaryRecord
            // is born and they could disagree about the same month. It also
            // wrote an adjustment row with no period and no provenance, which
            // is what made a penalty impossible to trace back to its task.
            const { SalaryService } = await import("./salary.service")
            const { month: currentMonth, year: currentYear } = await SalaryService.applyAdjustment({
                userId: targetUserId,
                type: 'DEDUCTION',
                amount,
                source: 'TASK_PENALTY',
                sourceId: id,
                reason: "Lateness Penalty Deduction",
            }, tx)

            const comments: any[] = Array.isArray(task.comments) ? task.comments : []
            comments.push({
                text: `Lateness Penalty Deduction applied with ${amount} days`,
                author: "System",
                date: now.toISOString(),
                type: 'SYSTEM_DEDUCTION',
                amount: amount
            })

            await tx.task.update({
                where: { id },
                data: { comments }
            })

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('APPLY_TASK_PENALTY', 'TASK', id, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: { targetUserId, amount, month: currentMonth, year: currentYear, reason: "Lateness Penalty Deduction" }
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

            // Identification and Company Isolation Check
            const keptIds = newAssigneeIds.filter((id: string) => currentAssigneeIds.includes(id))
            const addedIds = newAssigneeIds.filter((id: string) => !currentAssigneeIds.includes(id))
            const removedIds = currentAssigneeIds.filter((id: string) => !newAssigneeIds.includes(id))

            if (userRole !== 'SUPER_ADMIN' && addedIds.length > 0) {
                const targetUsers = await tx.user.findMany({
                    where: { id: { in: addedIds } },
                    select: { companyId: true, role: true }
                })
                const userCompanyId = session.user.companyId
                if (targetUsers.some(u => u.companyId !== userCompanyId)) {
                    throw new Error("CROSS_COMPANY_TRANSFER_FORBIDDEN")
                }
                // TEAM_LEADER Restriction check for ADDED users
                if (userRole === 'TEAM_LEADER') {
                    if (targetUsers.some(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))) {
                        throw new Error("TL_RESTRICTION")
                    }
                }
            }

            // 2. Prepare original task update
            const existingComments: any[] = Array.isArray(originalTask.comments) ? originalTask.comments : []

            const transferComment = {
                text: `Task transfer processed. (Transferred to ${newAssigneeIds.length} users).`,
                author: "System",
                date: new Date().toISOString(),
                type: 'TASK_TRANSFERRED'
            }

            await (tx.task as any).update({
                where: { id },
                data: {
                    status: 'PENDING_CONFIRMATION',
                    comments: [...existingComments, transferComment],
                    lastStatusUpdateBy: `${userRole} ${session.user.name}`
                }
            })

            // 3. Create Copy for ADDED assignees
            const commentsToClone: any[] = Array.isArray(originalTask.comments)
                ? originalTask.comments.filter((c: any) => c.type !== 'COST_ADDITION' && c.type !== 'LOCATION_ADDED' && c.type !== 'TASK_TRANSFERRED')
                : []

            let newTask: any = null
            if (addedIds.length > 0) {
                const baseTitle = originalTask.title.replace(/\s\(Transfer Copy\)$/, '')
                newTask = await (tx.task as any).create({
                    data: {
                        title: baseTitle + " (Transfer Copy)",
                        description: originalTask.description,
                        companyId: originalTask.companyId,
                        assignees: { connect: newAssigneeIds.map((id: string) => ({ id })) },
                        deadline: originalTask.deadline,
                        difficulty: originalTask.difficulty,
                        status: 'PENDING',
                        createdBy: originalTask.createdBy,
                        attachments: originalTask.attachments,
                        location: originalTask.location,
                        comments: [...commentsToClone, {
                            text: `Transferred from task "${originalTask.title}".`,
                            author: "System",
                            date: new Date().toISOString(),
                            type: 'TASK_CREATED'
                        }]
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

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('TRANSFER_TASK', 'TASK', originalTask.id, {
                tx,
                userId: userRole === 'SUPER_ADMIN' ? null : userId,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: {
                    addedCount: addedIds.length,
                    removedCount: removedIds.length,
                    keptCount: keptIds.length,
                    newAssigneeIds: newAssigneeIds.map((id: string) => id)
                }
            })

            return { originalId: originalTask.id, clones: newTask ? 1 : 0 }
        })
    }

    /**
     * Acknowledges a task edit.
     */
    /**
     * Clears the "this task was edited" notice. It is the assignee telling us
     * they have seen the change, so only an assignee may clear it — anyone
     * else doing so hides the change from the person it was for. The Super
     * Admin may, as everywhere.
     */
    static async acknowledge(id: string, session: any) {
        const task = await prisma.task.findUnique({
            where: { id },
            select: { assignees: { select: { id: true } } },
        })
        if (!task) throw new Error("TASK_NOT_FOUND")
        const isAssignee = task.assignees.some(a => a.id === session.user.id)
        if (!isAssignee && session.user.role !== 'SUPER_ADMIN') throw new Error("ACCESS_DENIED")

        return await prisma.task.update({
            where: { id },
            data: { isEdited: false }
        })
    }

    /**
     * Deletes a task.
     */
    static async delete(id: string, session: any) {
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id },
                select: { status: true, difficulty: true, assignees: { select: { id: true } }, attachments: true, companyId: true, title: true }
            })
            if (!task) throw new Error("TASK_NOT_FOUND")

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                const userCompanyId = (session.user as any).companyId
                if (task.companyId !== userCompanyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

            const isSelfAssigned = task.assignees.some((a: any) => a.id === userId)
            if (['ADMIN', 'SUPER_ADMIN'].includes(userRole) && isSelfAssigned) {
                throw new Error("SELF_DELETION_FORBIDDEN")
            }

            if (Array.isArray(task.attachments)) {
                try {
                    const filePaths = task.attachments
                        .map((a: any) => a.url?.split('/app-assets/')?.[1])
                        .filter(path => !!path)
                    if (filePaths.length > 0) {
                        await supabase.storage.from('app-assets').remove(filePaths)
                    }
                } catch (e) {
                    console.error("Task attachment cleanup failed:", e)
                }
            }

            await tx.task.delete({ where: { id } })

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('DELETE_TASK', 'TASK', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: {
                    status: task.status,
                    title: task.title,
                    assigneeCount: task.assignees.length,
                    hasAttachments: !!task.attachments
                }
            })

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

            // Security: Company Isolation
            if (session.user.role !== 'SUPER_ADMIN') {
                if (task.companyId !== session.user.companyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }
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
            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('REVERT_TASK', 'TASK', task.id, {
                tx,
                superAdminId: isSuperAdminEntity ? userId : null,
                userId: isSuperAdminEntity ? null : userId,
                details: { oldStatus: task.status, newStatus: 'IN_PROGRESS', pointsDeducted: pointDeduction }
            })

            return updatedTask
        })
    }

    /**
     * Updates task payment status.
     */
    static async updatePayment(id: string, session: any, data: any) {
        const { paymentStatus, targetUserId } = data
        const userRole = session.user.role
        const userId = session.user.id

        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id },
                include: { assignees: { select: { id: true, companyId: true } } }
            })
            if (!task) throw new Error("TASK_NOT_FOUND")

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                const userCompanyId = (session.user as any).companyId
                if (task.companyId !== userCompanyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

            const updateData: any = {}
            const memberPayments: Record<string, string> = (task.memberPaymentStatus as any) || {}

            if (targetUserId) {
                memberPayments[targetUserId] = paymentStatus
                updateData.memberPaymentStatus = memberPayments
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
                    task.assignees.forEach(a => newPayments[a.id] = 'PAID')
                    updateData.memberPaymentStatus = newPayments
                } else {
                    updateData.status = 'APPROVED'
                    const newPayments: any = {}
                    task.assignees.forEach(a => newPayments[a.id] = 'PENDING_PAYMENT')
                    updateData.memberPaymentStatus = newPayments
                }
            }

            const updatedTaskRecord = await tx.task.update({ where: { id }, data: updateData })

            await tx.auditLog.create({
                data: {
                    action: 'UPDATE_PAYMENT_STATUS',
                    entityType: 'TASK',
                    entityId: id,
                    userId: userRole === 'SUPER_ADMIN' ? null : userId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: { paymentStatus: updateData.paymentStatus || updatedTaskRecord.paymentStatus, targetUserId, taskStatus: updateData.status || updatedTaskRecord.status }
                }
            })

            return updatedTaskRecord
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

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                if (task.companyId !== (session.user as any).companyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

            if (task.status !== 'IN_PROGRESS') throw new Error("TASK_NOT_IN_PROGRESS")

            const updateData: any = {}

            if (type === 'ATTACHMENT') {
                const attachments: any[] = Array.isArray(task.attachments) ? task.attachments : []
                const att = attachments.find((a: any) => a.url === itemId)
                if (!att) throw new Error("ITEM_NOT_FOUND")

                const isAuthor = att.uploadedById === userId
                const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)
                if (!isAuthor && !isAdmin) throw new Error("UNAUTHORIZED_ITEM_DELETE")

                // Physical Deletion
                try {
                    const parts = att.url.split('/app-assets/')
                    if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
                } catch (e) {
                    console.error("Task item attachment cleanup failed:", e)
                }

                updateData.attachments = attachments.filter((a: any) => a.url !== itemId)
            } else if (type === 'COST_ADDITION' || type === 'SUBMISSION_NOTE' || type === 'LOCATION_ADDED') {
                const comments: any[] = Array.isArray(task.comments) ? task.comments : []
                const item = comments.find((c: any) => c.type === type && (c.date === itemId || c.timestamp === itemId))
                if (!item) throw new Error("ITEM_NOT_FOUND")

                const isAuthor = item.authorId === userId
                const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)
                if (!isAuthor && !isAdmin) throw new Error("UNAUTHORIZED_ITEM_DELETE")

                updateData.comments = comments.filter((c: any) => !(c.type === type && (c.date === itemId || c.timestamp === itemId)))

                if (type === 'COST_ADDITION' && item.amount) {
                    updateData.totalCost = { decrement: item.amount }
                    const memberCosts: Record<string, number> = (task.memberCosts as any) || {}
                    if (item.authorId && memberCosts[item.authorId]) {
                        memberCosts[item.authorId] = Math.max(0, memberCosts[item.authorId] - item.amount)
                        updateData.memberCosts = memberCosts
                    }
                }
            } else {
                throw new Error("INVALID_ITEM_TYPE")
            }

            const updated = await tx.task.update({ where: { id }, data: updateData })

            // Audit Log
            await tx.auditLog.create({
                data: {
                    action: 'DELETE_TASK_ITEM',
                    entityType: 'TASK',
                    entityId: id,
                    userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: { type, itemId }
                }
            })

            return updated
        })
    }

    /**
     * Verifies a location entry.
     */
    static async verifyLocation(id: string, session: any, timestamp: string, status: string) {
        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({ where: { id } })
            if (!task) throw new Error("TASK_NOT_FOUND")

            const comments: any[] = Array.isArray(task.comments) ? task.comments : []
            const idx = comments.findIndex((c: any) => c.type === 'LOCATION_ADDED' && c.date === timestamp)
            if (idx === -1) throw new Error("ITEM_NOT_FOUND")

            comments[idx].verificationStatus = status
            return await tx.task.update({ where: { id }, data: { comments } })
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

            // Pre-fetch company mappings for Super Admin path to avoid N+1
            const assigneeToCompanyMap = new Map<string, string>()
            if (userRole === 'SUPER_ADMIN') {
                const allAssigneeIds = Array.from(new Set(tasks.flatMap(t => t.assigneeIds || [])))
                const users = await tx.user.findMany({
                    where: { id: { in: allAssigneeIds } },
                    select: { id: true, companyId: true }
                })
                users.forEach(u => u.companyId && assigneeToCompanyMap.set(u.id, u.companyId))
            }

            // Same batch pre-fetch for vendors — the review modal already
            // resolved/validated these client-side, this is a server-side
            // safety net (same role as the deadline/attachment checks below),
            // not the primary check.
            const vendorIds = Array.from(new Set(tasks.map(t => t.vendorId).filter(Boolean)))
            const vendorMap = new Map<string, { id: string, companyId: string, locationName: string, locationLink: string | null }>()
            if (vendorIds.length > 0) {
                const vendors = await tx.vendor.findMany({
                    where: { id: { in: vendorIds } },
                    select: { id: true, companyId: true, locationName: true, locationLink: true }
                })
                vendors.forEach(v => vendorMap.set(v.id, v))
            }

            for (const task of tasks) {
                const { assigneeIds, deadline, vendorId, location: requestedLocation, ...rest } = task
                const deadlineDate = new Date(deadline)
                const minDeadline = earliestDeadline()
                if (deadlineDate < minDeadline) throw new Error(`DEADLINE_TOO_SOON: ${task.title}`)

                if (task.attachments && Array.isArray(task.attachments) && task.attachments.length > 20) {
                    throw new Error(`ATTACHMENT_LIMIT: ${task.title}`)
                }

                // difficulty safety clamping/rejection
                const difficulty = typeof task.difficulty === 'number' ? Math.min(Math.max(task.difficulty, 0), 10) : 0

                // Resolve companyId: From map (SA) or session (Admin)
                const taskCompanyId = userRole === 'SUPER_ADMIN'
                    ? (assigneeIds[0] ? assigneeToCompanyMap.get(assigneeIds[0]) : null)
                    : userCompanyId

                // Vendor resolution — same authoritative-location rule as
                // TaskService.create.
                let resolvedVendorId: string | null = null
                let resolvedLocation = requestedLocation
                if (vendorId) {
                    const vendor = vendorMap.get(vendorId)
                    if (!vendor) throw new Error(`VENDOR_NOT_FOUND: ${task.title}`)
                    if (userRole !== 'SUPER_ADMIN' && vendor.companyId !== userCompanyId) {
                        throw new Error(`CROSS_COMPANY_VENDOR: ${task.title}`)
                    }
                    if (userRole === 'SUPER_ADMIN' && taskCompanyId && vendor.companyId !== taskCompanyId) {
                        throw new Error(`CROSS_COMPANY_VENDOR: ${task.title}`)
                    }
                    resolvedVendorId = vendor.id
                    resolvedLocation = JSON.stringify({ name: vendor.locationName, link: vendor.locationLink || '' })
                }

                const createdTask = await (tx.task as any).create({
                    data: {
                        ...rest,
                        location: resolvedLocation,
                        vendorId: resolvedVendorId,
                        // rest.attachments/comments may still arrive as a JSON
                        // string from the bulk-import payload (same shape as
                        // the single-task create path) — normalize the same way.
                        ...(rest.attachments !== undefined ? { attachments: normalizeJsonInput(rest.attachments) } : {}),
                        ...(rest.comments !== undefined ? { comments: normalizeJsonInput(rest.comments) } : {}),
                        status: "PENDING",
                        deadline: deadlineDate,
                        difficulty: difficulty,
                        createdBy: userRole === 'SUPER_ADMIN' ? null : userId,
                        companyId: taskCompanyId,
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

            // Audit Log
            await tx.auditLog.create({
                data: {
                    action: 'BULK_CREATE_TASKS',
                    entityType: 'TASK',
                    entityId: 'BATCH',
                    userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: { count: results.length, taskTitles: results.map(t => t.title) }
                }
            })

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
            const whereClause: any = {
                id: { in: taskIds },
                paymentStatus: 'PENDING_PAYMENT'
            }

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                whereClause.companyId = (session.user as any).companyId
            }

            const tasks = await tx.task.findMany({
                where: whereClause,
                select: { id: true, memberCosts: true } as any
            })

            if (tasks.length !== taskIds.length && userRole !== 'SUPER_ADMIN') {
                throw new Error("SOME_TASKS_NOT_FOUND_OR_ACCESS_DENIED")
            }

            for (const task of tasks) {
                const mCosts: Record<string, number> = (task.memberCosts as any) || {}

                // Mark all members as PAID
                const newMemberPaymentStatus: Record<string, string> = {}
                Object.keys(mCosts).forEach(uid => {
                    newMemberPaymentStatus[uid] = 'PAID'
                })

                await tx.task.update({
                    where: { id: (task as any).id },
                    data: {
                        paymentStatus: 'PAID',
                        status: 'COMPLETED',
                        memberPaymentStatus: newMemberPaymentStatus,
                        updatedAt: new Date() // Force timestamp update for history
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
                    details: { taskIds, count: tasks.length, paymentStatus: 'PAID' }
                }
            })

            return { count: tasks.length }
        })
    }
}
