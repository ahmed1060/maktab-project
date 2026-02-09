import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { TaskService } from "@/lib/services/task.service"

export const POST = withStandardHandler(async (req, session, json) => {
    const userRole = session.user.role
    const creatorCompanyId = session.user.companyId

    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return ApiResponse.unauthorized()
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
        select: { id: true, companyId: true, role: true }
    })

    const userMap = new Map(assigneeUsers.map(u => [u.id, u]))

    for (const task of tasks) {
        const { title, description, assigneeIds, deadline } = task

        if (!title || title.length < 3) continue
        if (!description || description.length < 10) continue
        if (!deadline || isNaN(new Date(deadline).getTime())) continue
        if (!assigneeIds || assigneeIds.length === 0) continue

        let isTaskValid = true
        for (const aid of assigneeIds) {
            const user = userMap.get(aid)
            if (!user) { isTaskValid = false; break }

            if (userRole !== 'SUPER_ADMIN') {
                if (user.companyId !== creatorCompanyId) { isTaskValid = false; break }
                if (userRole === 'TEAM_LEADER' && ['ADMIN', 'SUPER_ADMIN'].includes(user.role)) { isTaskValid = false; break }
            }
        }

        if (isTaskValid) validTasks.push(task)
    }

    if (validTasks.length === 0) {
        return ApiResponse.badRequest("No valid tasks found to create")
    }

    try {
        const results = await TaskService.bulkCreate(validTasks, session)
        return ApiResponse.success({
            createdCount: results.length,
            message: `Successfully created ${results.length} tasks`
        }, 201)
    } catch (error: any) {
        console.error("[BULK_TASK_CREATE_ERROR]", error)
        if (error.code === 'P2003') {
            return ApiResponse.error("Database constraint violation. Please check if all assigned employees still exist.")
        }
        return ApiResponse.error(error.message || "Bulk creation failed")
    }
}, {
    audit: { action: 'BULK_CREATE_TASK', entityType: 'TASK', getEntityId: () => "BULK" }
})
