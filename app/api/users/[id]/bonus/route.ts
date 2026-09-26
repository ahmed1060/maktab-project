import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess, personTarget } from "@/lib/security"
import { can } from "@/lib/permissions/can"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    if (!can(session.user, "salary_adjustments.manage")) {
        return ApiResponse.forbidden()
    }

    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    // Nobody adjusts their own pay (ROLES_PLAN.md §4.2, rule 5): asked of the
    // person, which can() refuses when it is the caller.
    const person = await personTarget(userId)
    if (!person || !can(session.user, "salary_adjustments.manage", person)) {
        return ApiResponse.forbidden("You cannot adjust your own pay")
    }

    const { amount, reason } = json
    if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 1000) {
        return ApiResponse.badRequest("Invalid amount (1-1000)")
    }

    try {
        // Was passing `reason` where `session` belongs — addAdjustment's real
        // signature is (userId, type, amount, session, reason). session.user.role
        // would throw on every call (a pre-existing bug, unrelated to F-07).
        const adjustment = await SalaryService.addAdjustment(userId, 'BONUS', amount, session, reason)
        return ApiResponse.success({ id: userId, adjustmentId: adjustment.id })
    } catch (error: any) {
        console.error("Error adding bonus:", error)
        return ApiResponse.error("Failed to add bonus")
    }
})
