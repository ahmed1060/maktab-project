import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return ApiResponse.forbidden("Forbidden")
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access Denied")

    const { amount, userId } = json
    if (!amount || !userId) return ApiResponse.badRequest("Missing amount or userId")

    try {
        const result = await TaskService.applyPenalty(params.id, userId, amount, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'NOT_AN_ASSIGNEE') return ApiResponse.badRequest("A task's penalty falls on one of its own people")
        if (error.message === 'INVALID_ADJUSTMENT_AMOUNT') return ApiResponse.badRequest("The penalty must be a number of days above 0")
        console.error("Penalty API error:", error)
        throw error
    }
}, {
    audit: {
        action: 'APPLY_MANUAL_PENALTY',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
