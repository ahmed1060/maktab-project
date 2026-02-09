import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess } from "@/lib/security"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    const userRole = session.user.role

    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return ApiResponse.unauthorized()
    }

    const hasAccess = await verifyResourceAccess(session, params.id, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access Denied")

    try {
        const adjustments = await SalaryService.getAdjustments(params.id)
        return ApiResponse.success(adjustments)
    } catch (error) {
        console.error('Error fetching adjustments:', error)
        return ApiResponse.error("Failed to fetch adjustments")
    }
})
