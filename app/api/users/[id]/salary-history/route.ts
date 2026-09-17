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

    // The gap fill is named and called deliberately, rather than happening
    // inside getHistory as a side effect of reading. Same net result for this
    // screen — every month from the first record to this one — but getHistory
    // is now a read, so nothing else that wants the history has to accept a
    // write it did not ask for.
    await SalaryService.ensureRecordsThrough(userId)

    const history = await SalaryService.getHistory(userId)
    return ApiResponse.success(history)
})
