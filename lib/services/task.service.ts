import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { noticeRow } from "@/lib/notice-row"
import { roleKindParam } from "@/lib/notice"
import { can, canCompanyWide } from "@/lib/permissions/can"
import { scopesToTeam, assignedToTeamWhere, and } from "@/lib/team-scope"
import { checkAssignees } from "./assignee-guard"
import { CreateTaskInput, UpdateTaskInput } from "../validations/task.schema"
import { extractCoords, extractAccuracy, locationVerdict } from "@/lib/location"
import { supabase } from "@/lib/storage"
import { normalizeJsonInput } from "@/lib/json-input"
import { SystemSettingsService } from "./system-settings.service"
import { earliestDeadline } from "@/lib/deadline"
import { isReviewed } from "@/lib/task-reviewed"
import { shareOwed, allSharesPaid } from "@/lib/cost-shares"
import { LocationService } from "./location.service"
import { snapshotOf } from "./costs-query"
import { asRecord } from "@/lib/costs-total"
import { cents, costEntry, isCostEntry, readDescription } from "@/lib/task-costs"

/**
 * Where a task's check measures from (CLIENTS_PLAN.md §2.5): its location's
 * pin, and that location's own radius or the system's. A task from before
 * locations has its typed location's coordinates, if it had any, and the
 * system's radius.
 */
async function checkTarget(task: { location: string | null; place: { latitude: number | null; longitude: number | null; radiusMeters: number | null } | null }) {
    const { locationVerifyRadiusMeters } = await SystemSettingsService.get()
    if (task.place && task.place.latitude !== null && task.place.longitude !== null) {
        return { coords: { lat: task.place.latitude, lng: task.place.longitude }, radius: task.place.radiusMeters ?? locationVerifyRadiusMeters }
    }
    const coords = extractCoords(task.location)
    return coords ? { coords, radius: locationVerifyRadiusMeters } : null
}

const PLACE = { select: { latitude: true, longitude: true, radiusMeters: true } } as const

/** A task's location text by its name, for its history: JSON from the form, or plain text from before it. */
function nameOf(text: string | null): string | null {
    if (!text) return null
    try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed.name === "string") return parsed.name
    } catch { /* plain text */ }
    return text
}

/**
 * A task's client, held until the task is written, as archiving holds it
 * (CLIENTS_PLAN.md §4.3): one archived meanwhile is seen here, and takes no
 * new work.
 */
async function holdClientInUse(tx: Prisma.TransactionClient, clientId: string) {
    const [held] = await tx.$queryRaw<{ archived: boolean }[]>`SELECT "archivedAt" IS NOT NULL AS archived FROM "Client" WHERE id = ${clientId} FOR SHARE`
    if (!held) throw new Error("CLIENT_NOT_FOUND")
    if (held.archived) throw new Error("CLIENT_ARCHIVED")
}

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

        // A typed location is no more (CLIENTS_PLAN.md §2.3): one is picked,
        // and its text below takes the place of any the request carried.
        const { assigneeIds, deadline, clientId, locationId, ...rest } = input
        const deadlineDate = new Date(deadline)
        if (!locationId) throw new Error("TASK_LOCATION_REQUIRED")

        // 1. Cross-Company Assignment Validation
        if (userRole !== 'SUPER_ADMIN') {
            if (!userCompanyId) throw new Error("USER_NO_COMPANY")

            const verdict = await checkAssignees(assigneeIds, session, "tasks.create")
            if (!verdict.ok) throw new Error(CREATE_CODES[verdict.reason])
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

        // The client, optional, and the location, its client's or a shared
        // one, each the task's company's.
        let resolvedClientId: string | null = null
        if (clientId) {
            const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, companyId: true, archivedAt: true } })
            if (!client) throw new Error("CLIENT_NOT_FOUND")
            if (client.companyId !== targetCompanyId) throw new Error("CROSS_COMPANY_CLIENT_FORBIDDEN")
            // An archived client takes no new work (CLIENTS_PLAN.md §4.3).
            if (client.archivedAt) throw new Error("CLIENT_ARCHIVED")
            resolvedClientId = client.id
        }

        // 3. Database Transaction
        return await prisma.$transaction(async (tx) => {
            if (resolvedClientId) await holdClientInUse(tx, resolvedClientId)
            const place = await LocationService.forTask(tx, locationId, { companyId: targetCompanyId, clientId: resolvedClientId })
            const task = await tx.task.create({
                data: {
                    ...rest,
                    // Its name and map link, as the releases before read them.
                    location: place.text,
                    locationId: place.id,
                    clientId: resolvedClientId,
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
                    ...noticeRow({ key: 'notice_task_assigned', params: { title: input.title } }),
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
        const { title, description, assigneeIds, deadline, difficulty, clientId, locationId, attachments } = input
        const userRole = session.user.role
        const userName = session.user.name

        const existingTask = await prisma.task.findUnique({
            where: { id },
            select: {
                title: true, description: true, location: true, attachments: true, comments: true, companyId: true,
                clientId: true, locationId: true, client: { select: { name: true } },
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

        // Its client and its location, picked again (CLIENTS_PLAN.md §2.3,
        // §3.1): each the task's company's, the location its client's or a
        // shared one, and both in its history by name. A typed location is
        // no more, so one a request carries is ignored.
        const clientChanges = clientId !== undefined && (clientId || null) !== existingTask.clientId
        const newClientId = clientChanges ? clientId || null : existingTask.clientId
        if (clientChanges) {
            const client = newClientId ? await prisma.client.findUnique({ where: { id: newClientId }, select: { companyId: true, name: true, archivedAt: true } }) : null
            if (newClientId && !client) throw new Error("CLIENT_NOT_FOUND")
            if (client && client.companyId !== existingTask.companyId) throw new Error("CROSS_COMPANY_CLIENT_FORBIDDEN")
            if (client?.archivedAt) throw new Error("CLIENT_ARCHIVED")
            changes.client = { from: existingTask.client?.name ?? null, to: client?.name ?? null }
        }
        let place: Awaited<ReturnType<typeof LocationService.forTask>> | null = null
        if (clientChanges || (locationId !== undefined && locationId !== existingTask.locationId)) {
            const picked = locationId || existingTask.locationId
            if (!picked) throw new Error("TASK_LOCATION_REQUIRED")
            place = await LocationService.forTask(prisma, picked, { companyId: existingTask.companyId, clientId: newClientId })
            if (place.id !== existingTask.locationId) changes.location = { from: nameOf(existingTask.location), to: place.label }
        }

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
        if (place && changes.location && autoVerifyLocation) {
            const target = await checkTarget({ location: place.text, place: place.place })
            if (target) {
                const { coords: targetCoords, radius } = target
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
                            targetCoords, submittedCoords, radius, accuracy,
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
            ...(place && { location: place.text, locationId: place.id }),
            ...(clientChanges && { clientId: newClientId }),
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
            const verdict = await checkAssignees(assigneeIds, session, "tasks.create")
            if (!verdict.ok) throw new Error(CREATE_CODES[verdict.reason])
            updateData.assignees = { set: assigneeIds.map((uid: string) => ({ id: uid })) }
        }

        return await prisma.$transaction(async (tx) => {
            if (clientChanges && newClientId) await holdClientInUse(tx, newClientId)
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
                        ...noticeRow({ key: 'notice_task_updated', params: { title: title || existingTask.title, role: roleKindParam(userRole), name: userName } }),
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
        // Each cost with its description, kept to the cent; one of nothing
        // isn't one. Refused before anything is read.
        const costs: { amount: number; description: string | null }[] = []
        const addCost = (amount: unknown, description: unknown) => {
            const value = cents(Number(amount))
            if (value > 0) costs.push({ amount: value, description: readDescription(description) })
        }
        if (data.cost) addCost(data.cost, data.costDescription)
        if (Array.isArray(inputCosts)) for (const c of inputCosts) addCost(c?.amount, c?.description)

        return await prisma.$transaction(async (tx) => {
            // Held while its comments are read and written back: two people
            // saving at once each wrote the comments as they'd read them, so
            // one's costs went from the list while their total stayed.
            await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`
            const currentTask = await tx.task.findUnique({
                where: { id },
                include: { assignees: true, company: { select: { autoVerifyLocation: true } }, place: PLACE }
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
            // Your own task, or one you may edit — a manager submitting on
            // someone's behalf.
            if (!isAssignee && !can(session.user, "tasks.edit")) throw new Error("ACCESS_DENIED")
            // A decided task is not submitted again: it went back to awaiting
            // confirmation with its points still held, so approving it again
            // added them a second time, and new costs changed what a paid
            // task owes. A rejected one is redone and submitted, as before.
            if (['APPROVED', 'COMPLETED'].includes(currentTask.status)) throw new Error("TASK_ALREADY_DECIDED")

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

            const totalAdded = cents(costs.reduce((sum, c) => sum + c.amount, 0))
            if (totalAdded > 10000) throw new Error("COST_LIMIT_EXCEEDED")

            // Each cost a row (CLIENTS_PLAN.md §4.5) and an entry naming it,
            // which the release before reads.
            const addedAt = new Date().toISOString()
            const rows = costs.map(c => ({ id: randomUUID(), taskId: id, authorId: userId, authorName: session.user.name ?? null, amount: c.amount, description: c.description }))
            for (const r of rows) {
                comments.push(costEntry({ id: r.id, amount: r.amount, description: r.description, author: r.authorName, authorId: userId, date: addedAt }))
            }

            if (location) {
                const userLocs = comments.filter((c: any) => c.type === 'LOCATION_ADDED' && c.authorId === userId)
                if (userLocs.length >= 10) throw new Error("USER_LOCATION_LIMIT")

                const locationComment: any = { text: locationName ? `Location: ${locationName}` : `Location: ${location}`, location, locationName, author: session.user.name, authorId: userId, date: new Date().toISOString(), type: 'LOCATION_ADDED' }

                // Company Settings' autoVerifyLocation gates this entirely — a
                // task with no company (only possible when SUPER_ADMIN-created)
                // defaults to on, same as a fresh Company row would.
                const autoVerifyLocation = currentTask.company?.autoVerifyLocation ?? true
                // Measured from its location's pin, within that location's own
                // radius when it has one (CLIENTS_PLAN.md §2.5).
                const target = autoVerifyLocation ? await checkTarget(currentTask) : null
                if (target) {
                    const submittedCoords = extractCoords(location)
                    if (submittedCoords) {
                        locationComment.verificationStatus = locationVerdict(
                            target.coords,
                            submittedCoords,
                            target.radius,
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

                memberCosts[userId] = cents((memberCosts[userId] || 0) + totalAdded)
                memberPaymentStatus[userId] = 'PENDING_PAYMENT'

                updateData.memberCosts = memberCosts
                updateData.memberPaymentStatus = memberPaymentStatus
                updateData.totalCost = { increment: totalAdded }
            }

            const task = await tx.task.update({ where: { id }, data: updateData })
            if (rows.length > 0) await tx.taskCost.createMany({ data: rows })

            if (!isDraft && task.createdBy) {
                await tx.notification.create({
                    data: { userId: task.createdBy, type: 'TASK_SUBMITTED', ...noticeRow({ key: 'notice_task_submitted', params: { title: task.title, name: session.user.name ?? '' } }), relatedId: id }
                })
            }

            return task
        })
    }

    /**
     * Reviews a task submission.
     */
    static async review(id: string, session: any, data: any) {
        const { status: statusProp, action, difficulty } = data ?? {}
        const status = statusProp || action
        const userId = session.user.id
        const userRole = session.user.role
        // A decision the reviewer made, not a default: anything else used to
        // be read as a rejection, so an empty or mistyped request rejected the
        // task and took its points away.
        if (!['APPROVED', 'REJECTED', 'COMPLETED'].includes(status)) throw new Error("INVALID_REVIEW_STATUS")
        // Added to every assignee's points, so bounded as a task's is when it
        // is created (lib/validations/task.schema.ts).
        if (difficulty !== undefined && difficulty !== null && (typeof difficulty !== 'number' || !Number.isFinite(difficulty) || difficulty < 0 || difficulty > 10)) {
            throw new Error("INVALID_DIFFICULTY")
        }

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

            // Someone who reviews company-wide may not review their own work;
            // a team-scoped reviewer (a Team Leader) reviews their team's, their own among it.
            if (canCompanyWide(session.user, "tasks.review") && oldTask.assignees.some(a => a.id === userId)) {
                throw new Error("SELF_REVIEW_FORBIDDEN")
            }

            let newStatus = status
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
            const task = await tx.task.findUnique({ where: { id }, include: { assignees: { select: { id: true, teamLeaderId: true } } } })
            if (!task) throw new Error("TASK_NOT_FOUND")
            // A task's penalty falls on one of its own people. The id came
            // from the request and was never checked against the task: anyone
            // allowed to penalise one task could take pay from any account,
            // in any company, by naming it.
            const target = task.assignees.find(a => a.id === targetUserId)
            if (!target) throw new Error("NOT_AN_ASSIGNEE")
            // And within the scope the caller penalises at: held for a team,
            // a task shared with someone outside it is theirs to open, but
            // that person's pay is not theirs to cut.
            if (!can(session.user, "tasks.penalize", { companyId: task.companyId, userId: target.id, teamLeaderId: target.teamLeaderId })) {
                throw new Error("OUTSIDE_TEAM")
            }

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
            if (!isAssignee && !can(session.user, "tasks.transfer")) {
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
                if (scopesToTeam(session.user, "tasks.transfer")) {
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
                        // The same client and place: it's the same work.
                        clientId: originalTask.clientId,
                        locationId: originalTask.locationId,
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
                        ...noticeRow({ key: 'notice_task_transferred', params: { title: newTask.title } }),
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
            // Held until it's gone, as paying holds it: a payment recorded
            // meanwhile is read below, rather than deleted with the task.
            await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`
            const task = await tx.task.findUnique({
                where: { id },
                select: { status: true, difficulty: true, assignees: { select: { id: true } }, attachments: true, companyId: true, title: true, paymentStatus: true, memberPaymentStatus: true }
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
            if (canCompanyWide(session.user, "tasks.delete") && isSelfAssigned) {
                throw new Error("SELF_DELETION_FORBIDDEN")
            }

            // Its costs paid, it stays, and its payment record with it
            // (CLIENTS_PLAN.md §4.2): paid in full, or anyone's part of it,
            // their payments read as the task's page reads them.
            const paidParts = Object.values(asRecord(task.memberPaymentStatus))
            if (task.paymentStatus === 'PAID' || paidParts.includes('PAID')) throw new Error("TASK_HAS_PAID_COSTS")

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
                    ...noticeRow({ key: 'notice_task_reverted', params: { title: task.title } }),
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
        const { paymentStatus, targetUserId } = data ?? {}
        const userRole = session.user.role
        const userId = session.user.id
        // Paid or not, nothing else. Anything else used to be taken as "not
        // paid": the task went back to Approved and every assignee to unpaid,
        // under an audit entry saying the payment had changed.
        if (paymentStatus !== 'PAID' && paymentStatus !== 'PENDING_PAYMENT') throw new Error("INVALID_PAYMENT_STATUS")

        return await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id },
                include: { assignees: { select: { id: true, companyId: true, teamLeaderId: true } } }
            })
            if (!task) throw new Error("TASK_NOT_FOUND")

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                const userCompanyId = (session.user as any).companyId
                if (task.companyId !== userCompanyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

            // Only reviewed work is paid for, as the bulk route already holds:
            // paying a task still in progress marked it Completed, skipping
            // its review. And a per-person payment is for one of its people.
            if (!isReviewed(task.status)) throw new Error("TASK_NOT_REVIEWED")
            if (targetUserId) {
                const member = task.assignees.find(a => a.id === targetUserId)
                if (!member) throw new Error("NOT_AN_ASSIGNEE")
                // Within the scope the caller pays at, as a penalty is: on a
                // task shared with someone outside a team payer's team, that
                // person's payment is not theirs to record.
                if (!can(session.user, "tasks.pay", { companyId: task.companyId, userId: member.id, teamLeaderId: member.teamLeaderId })) throw new Error("OUTSIDE_TEAM")
            }

            const updateData: any = {}
            const memberPayments: Record<string, string> = (task.memberPaymentStatus as any) || {}

            if (targetUserId) {
                memberPayments[targetUserId] = paymentStatus
                updateData.memberPaymentStatus = memberPayments
                // Paid once no share is left, as the Costs page and Mark all as paid count it.
                const allPaid = allSharesPaid((task.memberCosts as any) || {}, memberPayments, task.totalCost)
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
     * A cost is found by its row's id (CLIENTS_PLAN.md §4.5), or, sent as
     * COST_ADDITION, by when it was added: a cost the release before added
     * has no row, and a page from before sends that.
     */
    static async deleteItem(id: string, session: any, data: any) {
        const { type, itemId } = data
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.$transaction(async (tx) => {
            // Held while its comments are read and written back.
            await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`
            const task = await tx.task.findUnique({ where: { id } })
            if (!task) throw new Error("TASK_NOT_FOUND")

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                if (task.companyId !== (session.user as any).companyId) {
                    throw new Error("ACCESS_DENIED")
                }
            }

            if (task.status !== 'IN_PROGRESS') throw new Error("TASK_NOT_IN_PROGRESS")
            // Without one, every entry with no time of its own matched, and
            // all of them went.
            if (typeof itemId !== 'string' || !itemId) throw new Error("ITEM_NOT_FOUND")

            const updateData: any = {}
            let costRow: string | null = null

            if (type === 'ATTACHMENT') {
                const attachments: any[] = Array.isArray(task.attachments) ? task.attachments : []
                const att = attachments.find((a: any) => a.url === itemId)
                if (!att) throw new Error("ITEM_NOT_FOUND")

                const isAuthor = att.uploadedById === userId
                const isAdmin = can(session.user, "tasks.edit")
                if (!isAuthor && !isAdmin) throw new Error("UNAUTHORIZED_ITEM_DELETE")

                // Physical Deletion
                try {
                    const parts = att.url.split('/app-assets/')
                    if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
                } catch (e) {
                    console.error("Task item attachment cleanup failed:", e)
                }

                updateData.attachments = attachments.filter((a: any) => a.url !== itemId)
            } else if (type === 'COST' || type === 'COST_ADDITION' || type === 'SUBMISSION_NOTE' || type === 'LOCATION_ADDED') {
                const comments: any[] = Array.isArray(task.comments) ? task.comments : []
                const isCost = type === 'COST' || type === 'COST_ADDITION'
                // Only the one found goes. Costs added together share the
                // time they were added, and all of them used to go, with
                // only the first one's amount taken off the totals.
                const index = type === 'COST'
                    ? comments.findIndex(c => isCostEntry(c) && c.costId === itemId)
                    : comments.findIndex((c: any) => c?.type === type && (c.date === itemId || c.timestamp === itemId))
                if (index < 0) throw new Error("ITEM_NOT_FOUND")
                const item = comments[index]

                const isAuthor = item.authorId === userId
                const isAdmin = can(session.user, "tasks.edit")
                if (!isAuthor && !isAdmin) throw new Error("UNAUTHORIZED_ITEM_DELETE")

                // Its person's costs on this task are paid: taking one off
                // would leave them paid more than they're owed (§4.2).
                const paid: Record<string, string> = (task.memberPaymentStatus as any) || {}
                if (isCost && (task.paymentStatus === 'PAID' || (item.authorId && paid[item.authorId] === 'PAID'))) throw new Error("COST_ALREADY_PAID")

                updateData.comments = comments.filter((_, i) => i !== index)

                if (isCost && item.amount) {
                    updateData.totalCost = { decrement: item.amount }
                    const memberCosts: Record<string, number> = (task.memberCosts as any) || {}
                    if (item.authorId && memberCosts[item.authorId]) {
                        memberCosts[item.authorId] = Math.max(0, cents(memberCosts[item.authorId] - item.amount))
                        updateData.memberCosts = memberCosts
                    }
                }
                if (isCost && typeof item.costId === 'string') costRow = item.costId
            } else {
                throw new Error("INVALID_ITEM_TYPE")
            }

            const updated = await tx.task.update({ where: { id }, data: updateData })
            if (costRow) await tx.taskCost.deleteMany({ where: { id: costRow, taskId: id } })

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

            // Same batch pre-fetch for clients — the review modal already
            // resolved/validated these client-side, this is a server-side
            // safety net (same role as the deadline/attachment checks below),
            // not the primary check.
            const clientIds = Array.from(new Set(tasks.map(t => t.clientId).filter(Boolean)))
            const clientMap = new Map<string, { id: string, companyId: string, archivedAt: Date | null }>()
            if (clientIds.length > 0) {
                // Held until the tasks are written, as archiving holds them, so
                // one archived meanwhile is read as it is (CLIENTS_PLAN.md §4.3).
                await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ANY(${clientIds}) ORDER BY id FOR SHARE`
                const clients = await tx.client.findMany({
                    where: { id: { in: clientIds } },
                    select: { id: true, companyId: true, archivedAt: true }
                })
                clients.forEach(v => clientMap.set(v.id, v))
            }

            for (const task of tasks) {
                // Each at a location picked on the review screen (CLIENTS_PLAN.md
                // §2.7); a typed one is no more, and its text below takes the
                // place of any the request carried.
                const { assigneeIds, deadline, clientId, locationId, ...rest } = task
                if (!locationId) throw new Error(`TASK_LOCATION_REQUIRED: ${task.title}`)
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

                // Client resolution — the same checks as TaskService.create.
                let resolvedClientId: string | null = null
                if (clientId) {
                    const client = clientMap.get(clientId)
                    if (!client) throw new Error(`CLIENT_NOT_FOUND: ${task.title}`)
                    if (userRole !== 'SUPER_ADMIN' && client.companyId !== userCompanyId) {
                        throw new Error(`CROSS_COMPANY_CLIENT: ${task.title}`)
                    }
                    if (userRole === 'SUPER_ADMIN' && taskCompanyId && client.companyId !== taskCompanyId) {
                        throw new Error(`CROSS_COMPANY_CLIENT: ${task.title}`)
                    }
                    if (client.archivedAt) throw new Error(`CLIENT_ARCHIVED: ${task.title}`)
                    resolvedClientId = client.id
                }
                const place = await LocationService.forTask(tx, String(locationId), { companyId: taskCompanyId ?? null, clientId: resolvedClientId })
                    .catch((error: Error) => { throw new Error(`${error.message}: ${task.title}`) })

                const createdTask = await (tx.task as any).create({
                    data: {
                        ...rest,
                        location: place.text,
                        locationId: place.id,
                        clientId: resolvedClientId,
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
                        ...noticeRow({ key: 'notice_task_imported', params: { title: task.title } }),
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
     *
     * With a member, pays only that member's share of each task, as the Costs
     * page lists one employee's costs (CLIENTS_PLAN.md §1). A task is paid once
     * no share of it is left to pay.
     *
     * With `confirmed`, the digest of what the person was shown (§4.1), what
     * the tasks owe is checked against it again while they're held, so
     * nothing changed since is paid unseen.
     */
    static async bulkUpdatePayment(taskIds: string[], session: any, memberId?: string, confirmed?: string) {
        const userId = session.user.id
        const userRole = session.user.role

        return await prisma.$transaction(async (tx) => {
            // Held, in one order, until this commits: a share paid or a cost
            // added meanwhile is read here, not overwritten with what was
            // read before it.
            await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ANY(${taskIds}) ORDER BY id FOR NO KEY UPDATE`
            if (confirmed !== undefined) {
                const held = await tx.task.findMany({ where: { id: { in: taskIds }, paymentStatus: 'PENDING_PAYMENT' }, select: { id: true, totalCost: true, memberCosts: true, memberPaymentStatus: true } })
                if (snapshotOf(held, memberId).digest !== confirmed) throw new Error("PAYMENT_LIST_CHANGED")
            }

            const whereClause: any = {
                id: { in: taskIds },
                paymentStatus: 'PENDING_PAYMENT'
            }

            // Security: Company Isolation
            if (userRole !== 'SUPER_ADMIN') {
                whereClause.companyId = (session.user as any).companyId
            }
            // And a team-scoped payer's team, whatever ids they were handed.
            if (scopesToTeam(session.user, "tasks.pay")) and(whereClause, assignedToTeamWhere(userId))

            const tasks = await tx.task.findMany({
                where: whereClause,
                select: { id: true, companyId: true, totalCost: true, memberCosts: true, memberPaymentStatus: true, assignees: { select: { id: true, teamLeaderId: true } } } as any
            })

            if (tasks.length !== taskIds.length && userRole !== 'SUPER_ADMIN') {
                throw new Error("SOME_TASKS_NOT_FOUND_OR_ACCESS_DENIED")
            }

            let count = 0
            for (const task of tasks as any[]) {
                const mCosts: Record<string, number> = task.memberCosts || {}

                if (memberId) {
                    const member = task.assignees.find((a: any) => a.id === memberId)
                    const payments: Record<string, string> = { ...(task.memberPaymentStatus || {}) }
                    if (!member || !shareOwed(mCosts[memberId], payments[memberId])) continue
                    // Within the payer's scope, as paying one person's share
                    // from the task's page is.
                    if (!can(session.user, "tasks.pay", { companyId: task.companyId, userId: member.id, teamLeaderId: member.teamLeaderId })) throw new Error("OUTSIDE_TEAM")

                    payments[memberId] = 'PAID'
                    const allPaid = allSharesPaid(mCosts, payments, task.totalCost)
                    await tx.task.update({
                        where: { id: task.id },
                        data: {
                            memberPaymentStatus: payments,
                            ...(allPaid && { paymentStatus: 'PAID', status: 'COMPLETED' }),
                            updatedAt: new Date()
                        } as any
                    })
                    count++
                    continue
                }

                // Mark all members as PAID
                const newMemberPaymentStatus: Record<string, string> = {}
                Object.keys(mCosts).forEach(uid => {
                    newMemberPaymentStatus[uid] = 'PAID'
                })

                await tx.task.update({
                    where: { id: task.id },
                    data: {
                        paymentStatus: 'PAID',
                        status: 'COMPLETED',
                        memberPaymentStatus: newMemberPaymentStatus,
                        updatedAt: new Date() // Force timestamp update for history
                    } as any
                })
                count++
            }

            await tx.auditLog.create({
                data: {
                    action: 'BULK_UPDATE_PAYMENT_STATUS',
                    entityType: 'TASK',
                    entityId: 'BULK',
                    userId: userRole === 'SUPER_ADMIN' ? null : userId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: { taskIds, count, paymentStatus: 'PAID', ...(memberId && { targetUserId: memberId }) }
                }
            })

            return { count }
        })
    }
}
