import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"

export const POST = withStandardHandler(async (req, session, json) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        return ApiResponse.unauthorized()
    }

    const { targetUserId, adminPassword } = json
    if (!targetUserId || !adminPassword) {
        return ApiResponse.badRequest("Missing required fields")
    }

    try {
        const password = await UserService.revealPassword(targetUserId, adminPassword, session.user.id)
        return ApiResponse.success({ password })
    } catch (error: any) {
        if (error.message === 'ADMIN_NOT_FOUND') return ApiResponse.notFound("Admin not found")
        if (error.message === 'INVALID_ADMIN_PASSWORD') return ApiResponse.forbidden("Invalid admin password")
        if (error.message === 'TARGET_USER_NOT_FOUND') return ApiResponse.notFound("Target user not found")
        if (error.message === 'PASSWORD_NOT_AVAILABLE') return ApiResponse.badRequest("Password not available")

        console.error('Password revelation error:', error)
        return ApiResponse.error("Failed to reveal password")
    }
}, {
    audit: {
        action: 'REVEAL_PASSWORD',
        entityType: 'USER',
        getEntityId: (res: any, body: any) => body.targetUserId
    }
})
