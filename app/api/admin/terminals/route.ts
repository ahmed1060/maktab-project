import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { terminalsOverview } from "@/lib/services/attendance-terminal-status"

/** Every company's agents and terminals, worst first, for System Health (ATTENDANCE_PLAN.md §13.2). */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success({ companies: await terminalsOverview() })
})
