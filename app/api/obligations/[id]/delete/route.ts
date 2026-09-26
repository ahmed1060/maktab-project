import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { canCompanyWide } from "@/lib/permissions/can"
import { ObligationService } from "@/lib/services/obligation.service"
import { verifyResourceAccess } from "@/lib/security"

export const DELETE = withStandardHandler(async (req, session, json, { params }) => {
    const obligationId = params.id

    // This path is for those who manage obligations company-wide; Team
    // Leaders delete within their team through DELETE /obligations/[id].
    if (!canCompanyWide(session.user, "obligations.manage")) {
        return ApiResponse.forbidden("Only Admins and Super Admins can delete obligations")
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, obligationId, 'OBLIGATION')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        await ObligationService.delete(obligationId, session)
        return ApiResponse.success({ success: true, id: obligationId })
    } catch (error: any) {
        if (error.message === 'OBLIGATION_NOT_FOUND') return ApiResponse.notFound("Obligation not found")
        if (error.message === 'ADMIN_CANNOT_DELETE_SELF_OBLIGATION') return ApiResponse.forbidden("Admins cannot delete their own obligations")
        console.error("Obligation deletion error:", error)
        return ApiResponse.error("Failed to delete obligation")
    }
}, {
    audit: {
        action: 'DELETE_OBLIGATION',
        entityType: 'OBLIGATION',
        getEntityId: (res: any) => res.id
    }
})
