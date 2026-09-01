import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { verifyResourceAccess } from "@/lib/security"

// Replaces the old /api/users/reveal (F-02). An admin can no longer see a
// user's actual password — they issue a fresh one-time temporary password
// instead, which the target must change at next login.
export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return ApiResponse.forbidden()
    }

    const targetUserId = params.id
    const hasAccess = await verifyResourceAccess(session, targetUserId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    const { confirmPassword } = json || {}
    if (!confirmPassword) return ApiResponse.badRequest("Missing required fields")

    try {
        const result = await UserService.resetPassword(
            targetUserId,
            { id: session.user.id, role: userRole },
            confirmPassword
        )
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'ADMIN_NOT_FOUND') return ApiResponse.notFound("Admin not found")
        if (error.message === 'INVALID_ADMIN_PASSWORD') return ApiResponse.forbidden("Invalid admin password")
        if (error.message === 'TARGET_USER_NOT_FOUND') return ApiResponse.notFound("Target user not found")

        console.error('Password reset error:', error)
        return ApiResponse.error("Failed to reset password")
    }
}, {
    rateLimit: { maxRequests: 10, windowMs: 60 * 60 * 1000 },
    audit: {
        action: 'RESET_PASSWORD',
        entityType: 'USER',
        getEntityId: (res: any) => res.targetUserId
    }
})
