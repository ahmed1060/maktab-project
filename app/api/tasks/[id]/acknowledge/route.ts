import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        await TaskService.acknowledge(taskId)
        return ApiResponse.success({ success: true })
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        console.error("Acknowledge API error:", error)
        return ApiResponse.error("Failed to acknowledge task edit")
    }
}, {
    audit: {
        action: 'ACKNOWLEDGE_TASK_EDIT',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
