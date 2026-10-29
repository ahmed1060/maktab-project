import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { updateTaskSchema } from "@/lib/validations/task.schema"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"
import { shapeTask } from "@/lib/permissions/shape"

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    if (!can(session.user, "tasks.edit")) {
        return ApiResponse.forbidden()
    }

    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK', "tasks.edit")
    if (!hasAccess) return ApiResponse.forbidden("Access Denied")

    // 1. Validation
    const validation = updateTaskSchema.safeParse({ ...json, id: params.id })
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await TaskService.updateDetails(params.id, validation.data, session)
        return ApiResponse.success(shapeTask(session.user, result))
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'DEADLINE_TOO_SOON') return ApiResponse.badRequest("Deadline must be at least 3 hours from now")
        // This path validated no assignees at all until now, so none of these
        // had anywhere to land.
        if (error.message === 'ASSIGNEE_NOT_FOUND') return ApiResponse.badRequest("One of those people no longer exists")
        if (error.message === 'CROSS_COMPANY_ASSIGNMENT_FORBIDDEN') return ApiResponse.forbidden("A task cannot be assigned outside its company")
        if (error.message === 'TL_CANNOT_ASSIGN_TO_ADMIN') return ApiResponse.forbidden("Team Leaders cannot assign tasks to Admins")
        if (error.message === 'TL_CANNOT_ASSIGN_OUTSIDE_TEAM') return ApiResponse.forbidden("Team Leaders can only assign tasks to their own team")
        if (error.message === 'CROSS_COMPANY_CLIENT_FORBIDDEN') return ApiResponse.forbidden("Cannot use a client from a different company")
        throw error
    }
})
