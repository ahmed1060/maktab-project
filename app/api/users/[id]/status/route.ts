import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id

    // 1. Company Isolation
    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    const { status } = json
    if (!status) return ApiResponse.badRequest("Status is required")

    try {
        const result = await UserService.updateStatus(userId, status, session.user.role)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden("Super Admin only")
        if (error.message === 'INVALID_STATUS') return ApiResponse.badRequest("Invalid status")
        throw error
    }
})
