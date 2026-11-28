import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryAdvanceService } from "@/lib/services/salary-advance.service"

/** Withdraws one's own salary advance while it waits (LATER_CHANGES_PLAN.md §7.5, step 3a, PR 449). */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const { id } = await context.params
    if (session.user.role === "SUPER_ADMIN") return ApiResponse.notFound("Request not found.")
    await SalaryAdvanceService.withdraw(id, session.user.id)
    return ApiResponse.success({ withdrawn: true })
})
