import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AccessReportService } from "@/lib/services/access-report.service"
import { denyUnlessSuperAdmin } from "@/lib/role-errors"

/**
 * "Who can do this?" (ROLES_PLAN.md §6.5). Super Admin only.
 *
 *   ?companyId=…&permission=…  everyone in the company holding it
 *   ?userId=…                  everything that person holds
 */
export const GET = withStandardHandler(async (req, session) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const params = new URL(req.url).searchParams
    const userId = params.get("userId")
    const companyId = params.get("companyId")
    const permission = params.get("permission")
    try {
        if (userId) return ApiResponse.success(await AccessReportService.whatCan(userId))
        if (companyId && permission) return ApiResponse.success(await AccessReportService.whoCan(companyId, permission))
        return ApiResponse.badRequest("Give a userId, or a companyId and a permission")
    } catch (error: any) {
        if (error?.message === "UNKNOWN_PERMISSION") return ApiResponse.badRequest("Unknown permission")
        if (error?.message === "USER_NOT_FOUND") return ApiResponse.notFound("User not found")
        throw error
    }
})
