import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess, personTarget } from "@/lib/security"
import { can } from "@/lib/permissions/can"
import { assertStepUp } from "@/lib/step-up"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const { id: userId, adjId } = params

    // 1. Company Isolation
    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    if (!can(session.user, "salary_adjustments.manage")) {
        return ApiResponse.forbidden()
    }

    // Nobody adjusts their own pay (ROLES_PLAN.md §4.2, rule 5).
    const person = await personTarget(userId)
    if (!person || !can(session.user, "salary_adjustments.manage", person)) {
        return ApiResponse.forbidden("You cannot adjust your own pay")
    }
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "salary_adjustments.manage")

    try {
        const result = await SalaryService.rollbackAdjustment(userId, adjId, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'INVALID_ADJUSTMENT') {
            return ApiResponse.badRequest("Invalid adjustment, or it has already been rolled back or reversed")
        }
        if (error.message === 'MONTH_CLOSED') {
            return ApiResponse.badRequest(
                "That month has been approved. Record a new adjustment against an open month instead — "
                + "undoing this one would move figures a payslip has already been issued for."
            )
        }
        if (error.message === 'RECORD_NOT_FOUND') {
            return ApiResponse.notFound("Salary record not found for this adjustment's month")
        }
        throw error
    }
})
