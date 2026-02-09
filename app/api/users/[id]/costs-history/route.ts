import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { verifyResourceAccess } from "@/lib/security"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    const userRole = session.user.role

    const isSelf = session.user.id === userId
    const isAuthorizedRole = ['ADMIN', 'SUPER_ADMIN'].includes(userRole)

    if (!isSelf && !isAuthorizedRole) {
        return ApiResponse.forbidden("Access denied")
    }

    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        const history = await UserService.getCostsHistory(userId)
        return ApiResponse.success(history)
    } catch (error: any) {
        console.error('Error fetching costs history:', error)
        return ApiResponse.error("Failed to fetch costs history")
    }
})
