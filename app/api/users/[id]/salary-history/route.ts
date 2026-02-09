import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess } from "@/lib/security"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    const currentUserId = session.user.id
    const userRole = session.user.role

    const isSelf = currentUserId === userId
    const isAuthorizedRole = ['ADMIN', 'SUPER_ADMIN'].includes(userRole)

    if (!isSelf && !isAuthorizedRole) {
        return ApiResponse.forbidden("Access denied")
    }

    // Company Isolation
    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        const history = await SalaryService.getHistory(userId)
        return ApiResponse.success(history)
    } catch (error: any) {
        throw error
    }
})
