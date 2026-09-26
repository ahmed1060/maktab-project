import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"
import { shapeTask } from "@/lib/permissions/shape"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden("Only Super Admins can revert tasks")

    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        const task = await TaskService.revert(taskId, session)
        return ApiResponse.success(shapeTask(session.user, task))
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'TASK_ALREADY_PAID') return ApiResponse.badRequest("Cannot revert task that has been paid")
        if (error.message.startsWith('CANNOT_REVERT_STATUS_')) return ApiResponse.badRequest(`Cannot revert task with status: ${error.message.split('_').pop()}`)
        console.error("Task reversion error:", error)
        return ApiResponse.error("Failed to revert task")
    }
}, {
    audit: {
        action: 'REVERT_TASK',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
