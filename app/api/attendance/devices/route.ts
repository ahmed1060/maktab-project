import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"
import { attendanceCompanyFor } from "@/lib/attendance/settings-access"
import { denyTerminals } from "@/lib/attendance/terminals-access"

/** The company's fingerprint terminals, as its agents report them (ATTENDANCE_PLAN.md §17). */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = attendanceCompanyFor(session, new URL(req.url).searchParams.get("companyId"))
    const denied = await denyTerminals(session, companyId, "view")
    if (denied) return denied
    return ApiResponse.success({ devices: await AttendanceDeviceService.list(companyId!) })
})
