import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK', "tasks.transfer")
    if (!hasAccess) return ApiResponse.forbidden("Access Denied")

    const { newAssigneeIds } = json
    if (!newAssigneeIds || !Array.isArray(newAssigneeIds) || newAssigneeIds.length === 0) {
        return ApiResponse.badRequest("New Assignee IDs array required")
    }

    try {
        const result = await TaskService.transfer(params.id, session, json)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'UNAUTHORIZED_TRANSFER') return ApiResponse.forbidden("Unauthorized to transfer this task")
        if (error.message === 'TL_RESTRICTION') return ApiResponse.forbidden("Team Leaders cannot transfer tasks to Admins")
        // Handing a task to somebody in another company. Unmapped, the refusal
        // escaped as a 500.
        if (error.message === 'CROSS_COMPANY_TRANSFER_FORBIDDEN') return ApiResponse.forbidden("A task cannot be transferred outside its company")
        console.error("Transfer error:", error)
        throw error
    }
}, {
    audit: {
        action: 'TRANSFER_TASK',
        entityType: 'TASK',
        getEntityId: (res: any) => res.originalId
    }
})
