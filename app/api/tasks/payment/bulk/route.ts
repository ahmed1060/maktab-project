import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { prisma } from "@/lib/prisma"
import { TaskService } from "@/lib/services/task.service"
import { scopesToTeam, assignedToTeamWhere } from "@/lib/team-scope"
import { pendingCostsSnapshot, pendingCostsWhere } from "@/lib/services/costs-query"
import { KNOWN_REFUSALS } from "@/lib/api-errors"
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
    const { taskIds, filters, confirm } = json
    let finalTaskIds = taskIds
    // With one employee picked, the Costs page lists their shares, and only
    // those are paid.
    let memberId: string | undefined
    // The list's digest as confirmed, when paying by the Costs page's filters (CLIENTS_PLAN.md §4.1).
    let confirmed: string | undefined

    try {
        if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
            if (!filters) return ApiResponse.badRequest("taskIds or filters required")

            if (userRole !== 'SUPER_ADMIN' && !userCompanyId) return ApiResponse.forbidden("No company assigned")
            // The Costs page's own query, so this pays the list shown: for a
            // Super Admin, the chosen company's, not every company's.
            // Exactly what the person confirmed, "Pay 7 costs, 3,450 EGP", and
            // nothing else: if the list has changed since, they look again.
            if (typeof confirm?.digest !== "string") return refuse("PAYMENT_CONFIRMATION_REQUIRED")
            // The list shows costs of one name, and a payment is a share of a
            // whole task: it would pay more than the list adds up to (§5.9).
            if (filters.costNameId) return refuse("PAYMENT_BY_COST_NAME")
            const where = await pendingCostsWhere(session.user, filters)
            if (!where) return ApiResponse.success({ count: 0 })

            if (filters.employeeId) memberId = String(filters.employeeId)
            const snapshot = await pendingCostsSnapshot(where, memberId)
            if (snapshot.digest !== confirm.digest) return refuse("PAYMENT_LIST_CHANGED")
            finalTaskIds = snapshot.taskIds
            confirmed = confirm.digest
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

        const result = await TaskService.bulkUpdatePayment(finalTaskIds, session, memberId, confirmed)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error?.message === "PAYMENT_LIST_CHANGED") return refuse("PAYMENT_LIST_CHANGED")
        console.error("Bulk payment status update failed", error)
        return ApiResponse.error("Failed to update payment status")
    }
}, {
    audit: { action: 'BULK_UPDATE_PAYMENT', entityType: 'TASK' }
})

function refuse(code: "PAYMENT_LIST_CHANGED" | "PAYMENT_CONFIRMATION_REQUIRED" | "PAYMENT_BY_COST_NAME") {
    const { status, message } = KNOWN_REFUSALS[code]
    return ApiResponse.error(message, status)
}
