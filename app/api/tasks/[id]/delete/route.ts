import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"

export const DELETE = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id
    const userRole = session.user.role
    const userId = session.user.id

    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return ApiResponse.forbidden("Only Admins and Team Leaders can delete tasks")
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        await TaskService.delete(taskId, userId, userRole)
        return ApiResponse.success({ success: true })
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'SELF_DELETION_FORBIDDEN') return ApiResponse.forbidden("Admins cannot delete their own tasks")
        console.error("Task deletion error:", error)
        return ApiResponse.error("Failed to delete task")
    }
}, {
    audit: {
        action: 'DELETE_TASK',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
