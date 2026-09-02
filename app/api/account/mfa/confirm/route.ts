import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { confirmMfaSchema } from "@/lib/validations/mfa.schema"
import { MfaService } from "@/lib/services/mfa.service"

export const POST = withStandardHandler(async (req, session, json) => {
    const validation = confirmMfaSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const { secret, code } = validation.data
    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'
    const actorId = session.user.id

    try {
        await MfaService.confirmEnrollment(
            isSuperAdmin ? { superAdminId: actorId } : { userId: actorId },
            secret,
            code
        )
    } catch (error: any) {
        if (error.message === 'INVALID_CODE') return ApiResponse.badRequest("Invalid code — check the time on your device and try again")
        throw error
    }

    return ApiResponse.success({ mfaEnabled: true })
})
