import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceFlagService } from "@/lib/services/attendance-flag.service"
import { punchCompany, decidesFor } from "@/lib/attendance/punch-access"

/**
 * Check-ins flagged for the company to decide (ATTENDANCE_PLAN.md §9.6,
 * §13.1): outside the place, a vague fix, off the office's network. For
 * whoever may correct the person's attendance, at their scope. Those flagged
 * because our app couldn't prove itself are the Super Admin's.
 */
export const GET = withStandardHandler(async (req, session) => {
    const access = await punchCompany(session, new URL(req.url).searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    const visible = decidesFor(session, "attendance.correct")
    if (!visible) return ApiResponse.forbidden()
    return ApiResponse.success({ checkIns: await AttendanceFlagService.list("COMPANY", { companyId: access.companyId, visible }) })
})
