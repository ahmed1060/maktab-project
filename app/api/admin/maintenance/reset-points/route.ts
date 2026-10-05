import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { StepUpError } from "@/lib/step-up"

export const POST = withStandardHandler(
    async (req, session, json) => {
        const { companyId } = json

        if (!companyId) return ApiResponse.badRequest("Company ID required")

        try {
            const result = await UserService.resetAllPoints(companyId, session)
            return ApiResponse.success({ success: true, count: result.count })
        } catch (error: any) {
            if (error instanceof StepUpError) throw error
            console.error("[RESET_POINTS_ERROR]", error)
            return ApiResponse.error("Failed to reset points")
        }
    },
    {
        allowedRoles: ['SUPER_ADMIN']
    }
)
