import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"
import { shapeTask } from "@/lib/permissions/shape"

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id
    const userId = session.user.id

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    const { note, costDescription, location } = json
    if (note && note.length > 500) return ApiResponse.badRequest("Note too long")
    if (costDescription && costDescription.length > 200) return ApiResponse.badRequest("Cost description too long")
    if (location && location.length > 200) return ApiResponse.badRequest("Location too long")

    try {
        const task = await TaskService.submit(taskId, userId, session, json)
        return ApiResponse.success(shapeTask(session.user, task))
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        // Refusals from TaskService.submit — not the caller's task, or not their
        // company. Unmapped, they escaped as a 500.
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden("Access denied")
        if (error.message === 'TASK_ALREADY_DECIDED') return ApiResponse.badRequest("This task has already been approved; it can't be submitted again")
        if (error.message === 'USER_LOCATION_LIMIT') return ApiResponse.badRequest("Location limit reached (10 per user)")
        console.error("Task submission error:", error)
        return ApiResponse.error("Failed to save task progress")
    }
}, {
    audit: {
        action: 'SUBMIT_TASK',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
