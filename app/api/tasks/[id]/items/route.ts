import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"

export const DELETE = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id

    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        await TaskService.deleteItem(taskId, session, json)
        return ApiResponse.success({ success: true })
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'TASK_NOT_IN_PROGRESS') return ApiResponse.badRequest("Items can only be deleted when task is IN_PROGRESS")
        if (error.message === 'UNAUTHORIZED_ITEM_DELETE') return ApiResponse.forbidden("Not authorized to delete this item")
        if (error.message === 'ITEM_NOT_FOUND') return ApiResponse.notFound("Item not found")
        // Anything else goes to the handler: a known refusal is answered
        // there, and a fault is logged with a reference.
        throw error
    }
}, {
    audit: {
        action: 'DELETE_TASK_ITEM',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
