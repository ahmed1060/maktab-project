import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AccessReviewService } from "@/lib/services/access-review.service"
import { denyUnlessSuperAdmin } from "@/lib/role-errors"

const settingsSchema = z.object({
    companyId: z.string().min(1),
    enabled: z.boolean(),
    // Quarterly suggested; the database holds the same bounds.
    months: z.number().int().min(1).max(12),
})

/**
 * Switch a company's periodic access review on or off (ROLES_PLAN.md §6.14).
 * The Super Admin's, as part of the company's contract — never the company's.
 */
export const PUT = withStandardHandler(async (req, session, json) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const validation = settingsSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const { companyId, enabled, months } = validation.data
    try {
        return ApiResponse.success(await AccessReviewService.configure(companyId, { enabled, months }, session))
    } catch (error: any) {
        if (error?.message === "COMPANY_NOT_FOUND") return ApiResponse.notFound("Company not found")
        throw error
    }
})
