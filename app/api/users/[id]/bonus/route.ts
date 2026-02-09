import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    const userRole = session.user.role

    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return ApiResponse.unauthorized()
    }

    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    const { amount, reason } = json
    if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 1000) {
        return ApiResponse.badRequest("Invalid amount (1-1000)")
    }

    try {
        const adjustment = await SalaryService.addAdjustment(userId, 'BONUS', amount, reason)
        return ApiResponse.success({ id: userId, adjustmentId: adjustment.id })
    } catch (error: any) {
        console.error("Error adding bonus:", error)
        return ApiResponse.error("Failed to add bonus")
    }
}, {
    audit: { action: 'ADD_BONUS', entityType: 'SALARY_ADJUSTMENT', getEntityId: (res) => res.adjustmentId }
})
