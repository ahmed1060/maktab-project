import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { verifyResourceAccess } from "@/lib/security"
import { can } from "@/lib/permissions/can"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id

    // One's own cost history is always theirs to see; anyone else's needs
    // costs.view, and verifyResourceAccess keeps that to the right company.
    const isSelf = session.user.id === userId

    if (!isSelf && !can(session.user, "costs.view")) {
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
