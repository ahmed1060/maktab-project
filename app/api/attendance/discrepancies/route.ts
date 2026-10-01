import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { AttendanceDiscrepancyService } from "@/lib/services/attendance-discrepancy.service"
import { punchCompany } from "@/lib/attendance/punch-access"

/** Attendance that changed after its payroll was approved (§12.3): for whoever sees payroll. */
export const GET = withStandardHandler(async (req, session) => {
    const access = await punchCompany(session, new URL(req.url).searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    if (!can(session.user, "payroll.view", { companyId: access.companyId })) return ApiResponse.forbidden()
    return ApiResponse.success({ discrepancies: await AttendanceDiscrepancyService.list(access.companyId) })
})
