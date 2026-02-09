import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { ObligationService } from "@/lib/services/obligation.service"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const obligationId = params.id
    const userRole = session.user.role

    if (userRole !== 'SUPER_ADMIN') {
        return ApiResponse.forbidden("Only Super Admins can revert obligations")
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, obligationId, 'OBLIGATION')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    try {
        const result = await ObligationService.revert(obligationId, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'OBLIGATION_NOT_FOUND') return ApiResponse.notFound("Obligation not found")
        console.error("Obligation reversion error:", error)
        return ApiResponse.error(error.message || "Failed to revert obligation")
    }
}, {
    audit: {
        action: 'REVERT_OBLIGATION',
        entityType: 'OBLIGATION',
        getEntityId: (res: any) => res.id
    }
})
