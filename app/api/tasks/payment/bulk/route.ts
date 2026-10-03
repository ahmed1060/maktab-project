import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { prisma } from "@/lib/prisma"
import { TaskService } from "@/lib/services/task.service"
import { scopesToTeam, assignedToTeamWhere } from "@/lib/team-scope"
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

    try {
        if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
            if (!filters) return ApiResponse.badRequest("taskIds or filters required")

            const where: any = {
                AND: [
                    { OR: [{ status: 'APPROVED' }, { status: 'COMPLETED' }, { status: 'REJECTED' }] },
                    { totalCost: { gt: 0 } },
                    { paymentStatus: 'PENDING_PAYMENT' }
                ]
            }

            if (userRole !== 'SUPER_ADMIN') {
                if (!userCompanyId) return ApiResponse.forbidden("No company assigned")
                where.AND.push({ assignees: { some: { companyId: userCompanyId } } })
            }
            // Someone who pays their team's tasks (tasks.pay at TEAM) pays
            // only those — the rule every single-task payment route applies.
            if (teamOnly) where.AND.push(assignedToTeamWhere(session.user.id))

            if (filters.employeeId) where.AND.push({ assignees: { some: { id: filters.employeeId } } })
            if (filters.search) where.AND.push({ title: { contains: filters.search, mode: 'insensitive' } })
            if (filters.dateFrom) where.AND.push({ updatedAt: { gte: new Date(filters.dateFrom) } })
            if (filters.dateTo) {
                const end = new Date(filters.dateTo); end.setHours(23, 59, 59, 999)
                where.AND.push({ updatedAt: { lte: end } })
            }

            const tasks = await prisma.task.findMany({ where, select: { id: true } })
            finalTaskIds = tasks.map(t => t.id)
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

        const result = await TaskService.bulkUpdatePayment(finalTaskIds, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        console.error("Bulk payment status update failed", error)
        return ApiResponse.error("Failed to update payment status")
    }
}, {
    audit: { action: 'BULK_UPDATE_PAYMENT', entityType: 'TASK' }
})
