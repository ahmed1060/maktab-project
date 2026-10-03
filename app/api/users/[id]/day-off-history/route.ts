import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { verifyResourceAccess, personTarget } from "@/lib/security"
import { can } from "@/lib/permissions/can"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    const currentUserId = session.user.id
    const isSelf = currentUserId === userId

    if (!isSelf && !can(session.user, "dayoff.view")) {
        return ApiResponse.forbidden()
    }

    // The grant's scope is about the person asked about: held for a team, it
    // reaches that team. The company check below keeps the rest out, but its
    // team rule is employees.view's, not this permission's.
    if (!isSelf) {
        const person = await personTarget(userId)
        if (!person || !can(session.user, "dayoff.view", person)) return ApiResponse.forbidden()
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
