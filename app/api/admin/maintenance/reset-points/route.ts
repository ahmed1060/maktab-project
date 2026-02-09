import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"

export const POST = withStandardHandler(
    async (req, session, json) => {
        const { companyId, passcode } = json

        if (!companyId) return ApiResponse.badRequest("Company ID required")
        if (!passcode) return ApiResponse.badRequest("Passcode required")

        try {
            const result = await UserService.resetAllPoints(companyId, passcode, session)
            return ApiResponse.success({ success: true, count: result.count })
        } catch (error: any) {
            if (error.message === 'INVALID_PASSCODE') return ApiResponse.forbidden("Invalid verification passcode")
            console.error("[RESET_POINTS_ERROR]", error)
            return ApiResponse.error("Failed to reset points")
        }
    },
    {
        allowedRoles: ['SUPER_ADMIN']
    }
)
