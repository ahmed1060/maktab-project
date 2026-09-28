import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"
import { shapeTask } from "@/lib/permissions/shape"
import { assertStepUp } from "@/lib/step-up"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    if (!can(session.user, "tasks.penalize")) {
        return ApiResponse.forbidden("Forbidden")
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK', "tasks.penalize")
    if (!hasAccess) return ApiResponse.forbidden("Access Denied")
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "tasks.penalize")

    const { amount, userId } = json
    if (!amount || !userId) return ApiResponse.badRequest("Missing amount or userId")

    try {
        const result = await TaskService.applyPenalty(params.id, userId, amount, session)
        return ApiResponse.success(shapeTask(session.user, result))
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
