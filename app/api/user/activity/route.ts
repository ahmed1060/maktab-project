import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { accountKind } from "@/lib/security"

export const POST = withStandardHandler(async (req, session) => {
    try {
        // The account's own kind, not a previewed role's: the id is the
        // Super Admin's while they preview one.
        const result = await UserService.updateActivity(session.user.id, accountKind(session.user) ?? session.user.role)
        return ApiResponse.success(result)
    } catch (error: any) {
        throw error
    }
})
