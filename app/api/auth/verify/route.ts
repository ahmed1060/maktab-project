import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"

export const POST = withStandardHandler(async (req, session, json) => {
    const { password } = json

    if (!password) {
        return ApiResponse.badRequest("Password required")
    }

    try {
        const result = await UserService.verifyPassword(session.user.id, password)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        console.error('Password verification error:', error)
        throw error
    }
})
