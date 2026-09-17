import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const { id: userId, adjId } = params

    // 1. Company Isolation
    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return ApiResponse.forbidden()
    }

    try {
        const result = await SalaryService.rollbackAdjustment(userId, adjId, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'INVALID_ADJUSTMENT') {
            return ApiResponse.badRequest("Invalid adjustment, or it has already been rolled back or reversed")
        }
        if (error.message === 'RECORD_NOT_FOUND') {
            return ApiResponse.notFound("Salary record not found for this adjustment's month")
        }
        throw error
    }
})
