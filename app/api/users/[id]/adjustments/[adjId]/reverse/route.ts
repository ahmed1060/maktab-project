import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess } from "@/lib/security"

/**
 * Undo an adjustment that was correct when it was made.
 *
 * Its own route rather than a flag on the rollback one, because the two are
 * different statements about what happened and each is audited under its own
 * action. Both remove the days from the month the adjustment landed on.
 */
export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const { id: userId, adjId } = params

    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return ApiResponse.forbidden()
    }

    const reason = typeof json?.reason === 'string' ? json.reason : undefined

    try {
        const result = await SalaryService.reverseAdjustment(userId, adjId, session, reason)
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
