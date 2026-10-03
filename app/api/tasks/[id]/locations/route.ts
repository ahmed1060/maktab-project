import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id

    // Verifying a location is the check on where somebody said they were, so
    // it is a manager's. The route asked only for the company, and
    // TaskService.verifyLocation asks nothing, so anyone in the company —
    // including the person who added the location — could mark it verified.
    if (!can(session.user, "tasks.review")) {
        return ApiResponse.forbidden("Only managers can verify locations")
    }

    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK', "tasks.review")
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    const { timestamp, action, verificationStatus } = json
    if (action !== 'VERIFY') return ApiResponse.badRequest("Invalid action")

    try {
        await TaskService.verifyLocation(taskId, session, timestamp, verificationStatus)
        return ApiResponse.success({ success: true })
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'ITEM_NOT_FOUND') return ApiResponse.notFound("Location entry not found")
        console.error("Location verification error:", error)
        return ApiResponse.error("Failed to verify location")
    }
}, {
    audit: {
        action: 'VERIFY_LOCATION',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})

export const DELETE = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id

    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    const { timestamp, date } = json
    const dateToDelete = date || timestamp

    try {
        await TaskService.deleteItem(taskId, session, { type: 'LOCATION_ADDED', itemId: dateToDelete })
        return ApiResponse.success({ success: true })
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'TASK_NOT_IN_PROGRESS') return ApiResponse.badRequest("Location deletion is only allowed when task is IN_PROGRESS")
        if (error.message === 'UNAUTHORIZED_ITEM_DELETE') return ApiResponse.forbidden("Not authorized to delete this location")
        if (error.message === 'ITEM_NOT_FOUND') return ApiResponse.notFound("Location entry not found")
        console.error("Location deletion error:", error)
        return ApiResponse.error("Failed to delete location")
    }
}, {
    audit: {
        action: 'DELETE_LOCATION',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
