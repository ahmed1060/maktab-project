import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id

    // 1. Company Isolation
    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        const result = await UserService.resetPoints(userId, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden("Unauthorized")
        // The Super Admin passes the company check for any id, so an unknown
        // one reaches here.
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        throw error
    }
})
