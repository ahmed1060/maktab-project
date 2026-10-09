import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"
import { shapeTask } from "@/lib/permissions/shape"
import { assertStepUp } from "@/lib/step-up"

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id

    if (!can(session.user, "tasks.pay")) {
        return ApiResponse.forbidden()
    }

    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK', "tasks.pay")
    if (!hasAccess) return ApiResponse.forbidden("Access denied")
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "tasks.pay")

    try {
        const task = await TaskService.updatePayment(taskId, session, json)
        return ApiResponse.success({ success: true, task: shapeTask(session.user, task) })
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        console.error("Payment update API error:", error)
        return ApiResponse.error("Failed to update payment status")
    }
}, {
    audit: {
        action: 'UPDATE_PAYMENT_STATUS',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
