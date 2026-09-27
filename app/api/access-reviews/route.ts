import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AccessReviewService } from "@/lib/services/access-review.service"

/**
 * Access reviews (ROLES_PLAN.md §6.14): a company's, for whoever gives roles
 * there; every company's for the Super Admin, who sees which are unanswered.
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    try {
        return ApiResponse.success(await AccessReviewService.list(session, { status: params.get("status"), companyId: params.get("companyId") }))
    } catch (error: any) {
        if (error?.message === "FORBIDDEN") return ApiResponse.forbidden()
        throw error
    }
})
