import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess, personTarget } from "@/lib/security"
import { can } from "@/lib/permissions/can"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    // Adjustments are salary figures, so seeing them is salary.view.
    if (!can(session.user, "salary.view")) {
        return ApiResponse.forbidden()
    }

    // The grant's scope is about the person asked about: held for a team, it
    // reaches that team. The company check below keeps the rest out, but its
    // team rule is employees.view's, not this permission's.
    const person = await personTarget(params.id)
    if (!person || !can(session.user, "salary.view", person)) return ApiResponse.forbidden("Access Denied")

    const hasAccess = await verifyResourceAccess(session, params.id, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access Denied")

    try {
        const adjustments = await SalaryService.getAdjustments(params.id)
        return ApiResponse.success(adjustments)
    } catch (error) {
        console.error('Error fetching adjustments:', error)
        return ApiResponse.error("Failed to fetch adjustments")
    }
})
