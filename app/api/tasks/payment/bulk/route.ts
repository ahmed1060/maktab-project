import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { prisma } from "@/lib/prisma"
import { TaskService } from "@/lib/services/task.service"
import { scopesToTeam, assignedToTeamWhere } from "@/lib/team-scope"
import { pendingCostsWhere } from "@/lib/services/costs-query"
import { assertStepUp } from "@/lib/step-up"

export const POST = withStandardHandler(async (req, session, json) => {
    const userRole = session.user.role
    const userCompanyId = session.user.companyId

    if (!can(session.user, "tasks.pay")) {
        return ApiResponse.forbidden()
    }
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "tasks.pay")

    const teamOnly = scopesToTeam(session.user, "tasks.pay")
    const { taskIds, filters } = json
    let finalTaskIds = taskIds
    // With one employee picked, the Costs page lists their shares, and only
    // those are paid.
    let memberId: string | undefined

    try {
        if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
            if (!filters) return ApiResponse.badRequest("taskIds or filters required")

            if (userRole !== 'SUPER_ADMIN' && !userCompanyId) return ApiResponse.forbidden("No company assigned")
            // The Costs page's own query, so this pays the list shown: for a
            // Super Admin, the chosen company's, not every company's.
            const where = await pendingCostsWhere(session.user, filters)
            if (!where) return ApiResponse.success({ count: 0 })

            const tasks = await prisma.task.findMany({ where, select: { id: true } })
            finalTaskIds = tasks.map(t => t.id)
            if (filters.employeeId) memberId = String(filters.employeeId)
        } else if (userRole !== 'SUPER_ADMIN') {
            if (!userCompanyId) return ApiResponse.forbidden("No company assigned")
            const valid = await prisma.task.findMany({
                where: {
                    AND: [
                        { id: { in: taskIds } },
                        { assignees: { some: { companyId: userCompanyId } } },
                        ...(teamOnly ? [assignedToTeamWhere(session.user.id)] : []),
                    ],
                },
                select: { id: true }
            })
            finalTaskIds = valid.map(t => t.id)
        }

        if (!finalTaskIds || finalTaskIds.length === 0) {
            return ApiResponse.success({ count: 0 })
        }

        const result = await TaskService.bulkUpdatePayment(finalTaskIds, session, memberId)
        return ApiResponse.success(result)
    } catch (error: any) {
        console.error("Bulk payment status update failed", error)
        return ApiResponse.error("Failed to update payment status")
    }
}, {
    audit: { action: 'BULK_UPDATE_PAYMENT', entityType: 'TASK' }
})
