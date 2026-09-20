import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { ObligationService } from "@/lib/services/obligation.service"
import { verifyResourceAccess } from "@/lib/security"

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    // 1. Security Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'OBLIGATION')
    if (!hasAccess) return ApiResponse.forbidden("Access Denied")

    // 2. Validation (Partial check)
    // Note: status updates might not need full title/desc, so we use partial or custom check
    // For now, accepting raw json as service handles specific fields safely

    try {
        // 3. Service
        const result = await ObligationService.update(params.id, json, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'OBLIGATION_NOT_FOUND') return ApiResponse.notFound("Obligation not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden("You don't have access to this obligation")
        if (error.message === 'SELF_APPROVAL_FORBIDDEN') return ApiResponse.forbidden("Admins cannot approve/reject their own obligations")
        if (error.message === 'UNAUTHORIZED_ATTACHMENT_REMOVAL') return ApiResponse.forbidden("Unauthorized to remove these attachments")
        if (error.message === 'TL_CANNOT_REASSIGN_TO_ADMIN') return ApiResponse.forbidden("Team Leaders cannot reassign to Admins")
        if (error.message === 'TL_CANNOT_REASSIGN_OUTSIDE_TEAM') return ApiResponse.forbidden("Team Leaders can only reassign within their own team")
        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session, _body, { params }) => {
    try {
        await ObligationService.delete(params.id, session)
        return ApiResponse.success({ success: true, id: params.id })
    } catch (error: any) {
        if (error.message === 'OBLIGATION_NOT_FOUND') return ApiResponse.notFound("Obligation not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden()
        if (error.message === 'ADMIN_CANNOT_DELETE_SELF_OBLIGATION') return ApiResponse.forbidden("Admins cannot delete their own obligations")
        throw error
    }
})
