import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"

export const POST = withStandardHandler(async (req, session) => {
    try {
        const result = await UserService.updateActivity(session.user.id, session.user.role)
        return ApiResponse.success(result)
    } catch (error: any) {
        throw error
    }
})
