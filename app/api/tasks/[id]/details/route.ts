import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { updateTaskSchema } from "@/lib/validations/task.schema"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return ApiResponse.unauthorized()
    }

    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access Denied")

    // 1. Validation
    const validation = updateTaskSchema.safeParse({ ...json, id: params.id })
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await TaskService.updateDetails(params.id, validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'DEADLINE_TOO_SOON') return ApiResponse.badRequest("Deadline must be at least 3 hours from now")
        throw error
    }
})
