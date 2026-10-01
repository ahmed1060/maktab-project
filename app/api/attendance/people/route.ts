import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePunchService } from "@/lib/services/attendance-punch.service"
import { punchCompany, visibilityFor } from "@/lib/attendance/punch-access"

/**
 * The people whose attendance the viewer sees, for the person picker: by
 * attendance.view_team's scope, not employees.view, so a role that keeps
 * attendance need not be able to open the employee list too.
 */
export const GET = withStandardHandler(async (req, session) => {
    const access = await punchCompany(session, new URL(req.url).searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    return ApiResponse.success({ people: await AttendancePunchService.people(access.companyId, visibilityFor(session)) })
})
