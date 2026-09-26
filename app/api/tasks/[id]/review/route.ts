import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { TaskService } from "@/lib/services/task.service"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const taskId = params.id

    // Reviewing decides a task's outcome and its difficulty, which become
    // performance points and payment. Only managers may: the screen offered
    // review to nobody else, but the route asked only for the company, so an
    // Employee could approve a task — their own included.
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(session.user.role)) {
        return ApiResponse.forbidden("Only managers can review tasks")
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, taskId, 'TASK')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        const task = await TaskService.review(taskId, session, json)
        return ApiResponse.success(task)
    } catch (error: any) {
        if (error.message === 'TASK_NOT_FOUND') return ApiResponse.notFound("Task not found")
        if (error.message === 'SELF_REVIEW_FORBIDDEN') return ApiResponse.forbidden("Admins cannot review their own tasks")
        console.error("Task review error:", error)
        return ApiResponse.error("Failed to process task review")
    }
}, {
    audit: {
        action: 'REVIEW_TASK',
        entityType: 'TASK',
        getEntityId: (res: any) => res.id
    }
})
