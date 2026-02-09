import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { verifyResourceAccess } from "@/lib/security"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    const currentUserId = session.user.id
    const userRole = session.user.role

    const isSelf = currentUserId === userId
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(userRole)

    if (!isSelf && !isAdmin) {
        return ApiResponse.unauthorized()
    }

    // Company Isolation
    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        const history = await UserService.getDayOffHistory(userId)
        return ApiResponse.success(history)
    } catch (error: any) {
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        throw error
    }
})
