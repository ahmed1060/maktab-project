import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { OWN_PASSWORD_TRIES } from "@/lib/own-password"

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
        // Its wrong tries are counted with a new password's (lib/own-password.ts).
        if (error.message === 'OWN_PASSWORD_TRIES') return ApiResponse.refused(429, OWN_PASSWORD_TRIES, 'OWN_PASSWORD_TRIES')
        console.error('Password verification error:', error)
        throw error
    }
})
