import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { prisma } from "@/lib/prisma"
import { TaskService } from "@/lib/services/task.service"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { earliestDeadline } from "@/lib/deadline"
import { scopesToTeam } from "@/lib/team-scope"
import { KNOWN_REFUSALS } from "@/lib/api-errors"

export const POST = withStandardHandler(async (req, session, json) => {
    const userRole = session.user.role
    const creatorCompanyId = session.user.companyId

    if (!can(session.user, "tasks.create")) {
        return ApiResponse.forbidden()
    }

    const { tasks } = json
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return ApiResponse.badRequest("No tasks provided")
    }

    if (tasks.length > 50) {
        return ApiResponse.badRequest("Maximum 50 tasks allowed in one bulk upload")
    }

    // 1. Pre-validation
    const validTasks: any[] = []
    const allAssigneeIds = Array.from(new Set(tasks.flatMap(t => t.assigneeIds || [])))

    const assigneeUsers = await prisma.user.findMany({
        where: { id: { in: allAssigneeIds } },
        select: { id: true, companyId: true, role: true, teamLeaderId: true }
    })

    const userMap = new Map(assigneeUsers.map(u => [u.id, u]))

    const validationSummary = {
        total: tasks.length,
        titleTooShort: 0,
        titleTooLong: 0,
        descTooShort: 0,
        descTooLong: 0,
        deadlineTooSoon: 0,
        noAssignees: 0,
        invalidAssignees: 0,
        invalidDifficulty: 0
    }

    for (const task of tasks) {
        const { title, description, assigneeIds, deadline, difficulty } = task

        if (!title || title.length < 3) { validationSummary.titleTooShort++; continue }
        if (title.length > 100) { validationSummary.titleTooLong++; continue }
        if (!description || description.length < 10) { validationSummary.descTooShort++; continue }
        if (description.length > 1000) { validationSummary.descTooLong++; continue }

        const diffInt = parseInt(difficulty) || 0
        if (diffInt < 0 || diffInt > 10) { validationSummary.invalidDifficulty++; continue }

        const deadlineDate = new Date(deadline)
        const minDeadline = earliestDeadline()
        if (!deadline || isNaN(deadlineDate.getTime()) || deadlineDate < minDeadline) { validationSummary.deadlineTooSoon++; continue }
        if (!assigneeIds || assigneeIds.length === 0) { validationSummary.noAssignees++; continue }

        let isTaskValid = true
        for (const aid of assigneeIds) {
            const user = userMap.get(aid)
            if (!user) { isTaskValid = false; break }

            if (userRole !== 'SUPER_ADMIN') {
                if (user.companyId !== creatorCompanyId) { isTaskValid = false; break }
                if (scopesToTeam(session.user, "tasks.create")) {
                    if (['ADMIN', 'SUPER_ADMIN'].includes(user.role)) { isTaskValid = false; break }
                    // Same rule as the single-task path. An import is the
                    // easiest way to assign a hundred tasks at once, so it is
                    // the last place the boundary should be looser.
                    if (user.id !== session.user.id && user.teamLeaderId !== session.user.id) { isTaskValid = false; break }
                }
            }
        }

        if (isTaskValid) validTasks.push(task)
        else validationSummary.invalidAssignees++
    }

    if (validTasks.length === 0) {
        let errorMsg = "No valid tasks found to create."
        if (validationSummary.deadlineTooSoon > 0) errorMsg += ` ${validationSummary.deadlineTooSoon} tasks had deadlines too soon.`
        if (validationSummary.titleTooShort > 0 || validationSummary.titleTooLong > 0) errorMsg += ` Some tasks had invalid title lengths.`
        if (validationSummary.noAssignees > 0) errorMsg += ` ${validationSummary.noAssignees} tasks had no assignees.`
        return ApiResponse.badRequest(errorMsg)
    }

    try {
        const results = await TaskService.bulkCreate(validTasks, session)
        return ApiResponse.success({
            createdCount: results.length,
            message: `Successfully created ${results.length} tasks`
        }, 201)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        // A task's client or location refused (CLIENTS_PLAN.md §2.7): said,
        // with the task's title, rather than logged as a fault.
        const refused = /^([A-Z_]+): ([\s\S]+)$/.exec(error?.message ?? "")
        const known = refused ? KNOWN_REFUSALS[refused[1]] : undefined
        if (refused && known) return ApiResponse.badRequest(`${refused[2]}: ${known.message}`)
        console.error("[BULK_TASK_CREATE_ERROR]", error)
        if (error.code === 'P2003') {
            return ApiResponse.error("Database constraint violation. Please check if all assigned employees still exist.")
        }
        const ref = await AuditLogService.logSystemError({ error, route: '/api/tasks/bulk', method: 'POST', userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null, superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}, {
    audit: { action: 'BULK_CREATE_TASK', entityType: 'TASK', getEntityId: () => "BULK" }
})
