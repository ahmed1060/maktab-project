import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { disableMfaSchema } from "@/lib/validations/mfa.schema"
import { MfaService } from "@/lib/services/mfa.service"

// F-27: a protected SuperAdmin can never disable MFA once enabled — this
// is what actually makes it "enforced" for that account, rather than a
// separate flag flipped later. Enrolling is still opt-in for them (see
// /api/account/mfa/enroll and /confirm); once they've enabled it
// themselves, there's no way back through this endpoint.
export const POST = withStandardHandler(async (req, session, json) => {
    if (session.user.role === 'SUPER_ADMIN' && session.user.isProtected) {
        return ApiResponse.forbidden("MFA cannot be disabled on this account")
    }

    const validation = disableMfaSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'
    const actorId = session.user.id

    try {
        await MfaService.disable(
            isSuperAdmin ? { superAdminId: actorId } : { userId: actorId },
            validation.data.password
        )
    } catch (error: any) {
        if (error.message === 'INVALID_PASSWORD') return ApiResponse.forbidden("Incorrect password")
        if (error.message === 'NOT_FOUND') return ApiResponse.notFound("Account not found")
        throw error
    }

    return ApiResponse.success({ mfaEnabled: false })
})
