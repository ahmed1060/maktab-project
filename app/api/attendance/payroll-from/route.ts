import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePolicyService } from "@/lib/services/attendance-policy.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"

/**
 * The first month whose attendance reaches payroll (ATTENDANCE_PLAN.md §12,
 * §20 Phase 1), and the earliest it may be: part of the Attendance settings tab.
 */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = attendanceCompanyFor(session, new URL(req.url).searchParams.get("companyId"))
    const denied = await denyAttendanceSettings(session, companyId, "view")
    if (denied) return denied
    return ApiResponse.success(await AttendancePolicyService.payrollFrom(companyId!))
})

const schema = z.object({
    companyId: z.string().optional(),
    /** YYYY-MM, or null for the dry run. */
    from: z.string().nullable(),
})

export const PUT = withStandardHandler(async (_req, session, json) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    return ApiResponse.success(await AttendancePolicyService.setPayrollFrom(companyId!, validation.data.from, session.user.id))
})
